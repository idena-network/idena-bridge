const os = require('os')
const path = require('path')

const CONTRACT = "0x0De08C1AbE5fB86Dd7FD2ac90400AcE305138d5B"
process.env.BSC_CONTRACT = CONTRACT
process.env.BSC_RPC = "http://127.0.0.1:1"
process.env.BSC_NETWORK = "56"
process.env.LOG_LEVEL = "silent"
process.env.LOG_DIR = path.join(os.tmpdir(), "idena-bridge-test-logs")

const {describe, it, beforeEach, afterEach, mock} = require('node:test')
const assert = require('node:assert/strict')
const ethers = require('ethers')
const abi = require('../bsc/abi.js')
const bsc = require('../bsc')

const iface = new ethers.utils.Interface(abi)
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
const OTHER_CONTRACT = "0x1111111111111111111111111111111111111111"
const SENDER = "0x2222222222222222222222222222222222222222"
const STRANGER = "0x3333333333333333333333333333333333333333"
const DEST = "0x4444444444444444444444444444444444444444"
const TX_HASH = "0x" + "ab".repeat(32)
const BLOCK_HASH = "0x" + "cd".repeat(32)
const SWAP_TIME = new Date("2026-01-01T00:00:00Z")

const wei = ethers.utils.parseEther

function transferLog(value, {from = SENDER, to = ZERO_ADDRESS, address = CONTRACT, logIndex = 0} = {}) {
    return {
        address,
        logIndex,
        topics: [
            iface.getEventTopic("Transfer"),
            ethers.utils.hexZeroPad(from, 32),
            ethers.utils.hexZeroPad(to, 32),
        ],
        data: ethers.utils.defaultAbiCoder.encode(["uint256"], [value]),
    }
}

function customBurnData(value, destination = DEST) {
    return iface.encodeFunctionData("customBurn", [value, destination])
}

function makeTx({data = customBurnData(wei("70")), from = SENDER, to = CONTRACT} = {}) {
    return {hash: TX_HASH, from, to, data, blockHash: BLOCK_HASH}
}

function makeReceipt(logs, {status = 1, to = CONTRACT} = {}) {
    return {transactionHash: TX_HASH, status, to, logs, confirmations: 20}
}

let chain

function mockProvider() {
    const proto = ethers.providers.JsonRpcProvider.prototype
    mock.method(proto, "getTransactionReceipt", async () => chain.receipt)
    mock.method(proto, "getTransaction", async () => chain.tx)
    mock.method(proto, "getBlock", async () => chain.block)
}

function setChain(receipt, tx) {
    chain = {
        receipt,
        tx,
        block: {timestamp: SWAP_TIME.getTime() / 1000 + 60},
    }
}

function validate(amount, address = DEST) {
    return bsc.validateBurnTx(null, TX_HASH, address, amount, SWAP_TIME)
}

describe("validateBurnTx", () => {
    beforeEach(mockProvider)
    afterEach(() => mock.restoreAll())

    it("rejects burn below the claimed amount", async () => {
        setChain(makeReceipt([transferLog(wei("70"))]), makeTx())
        const res = await validate("5000000.000000000000000000")
        assert.equal(res.valid, undefined)
        assert.equal(res.retry, undefined)
    })

    it("accepts burn of exactly the claimed amount", async () => {
        setChain(makeReceipt([transferLog(wei("70"))]), makeTx())
        const res = await validate("70.000000000000000000")
        assert.equal(res.valid, true)
        assert.equal(res.txReceipt, chain.receipt)
    })

    it("accepts burn of more than the claimed amount", async () => {
        setChain(makeReceipt([transferLog(wei("120"))]), makeTx())
        assert.equal((await validate("70.000000000000000000")).valid, true)
    })

    it("rejects burn slightly below the claimed amount", async () => {
        setChain(makeReceipt([transferLog(wei("70"))]), makeTx())
        const res = await validate("70.000000000000000001")
        assert.equal(res.valid, undefined)
        assert.equal(res.retry, undefined)
    })

    it("rejects burn of a smaller whole amount", async () => {
        setChain(makeReceipt([transferLog(wei("69"))]), makeTx())
        assert.equal((await validate("70")).valid, undefined)
    })

    it("rejects Transfer emitted by another contract", async () => {
        setChain(makeReceipt([transferLog(wei("70"), {address: OTHER_CONTRACT})]), makeTx())
        assert.equal((await validate("70")).valid, undefined)
    })

    it("ignores another contract's Transfer when summing", async () => {
        setChain(makeReceipt([
            transferLog(wei("10"), {logIndex: 0}),
            transferLog(wei("60"), {address: OTHER_CONTRACT, logIndex: 1}),
        ]), makeTx())
        assert.equal((await validate("70")).valid, undefined)
    })

    it("accepts burn when the token log is not the first one", async () => {
        setChain(makeReceipt([
            {address: OTHER_CONTRACT, logIndex: 0, topics: ["0x" + "11".repeat(32)], data: "0x"},
            transferLog(wei("70"), {logIndex: 1}),
        ]), makeTx())
        assert.equal((await validate("70")).valid, true)
    })

    it("sums several burn Transfer logs", async () => {
        setChain(makeReceipt([
            transferLog(wei("30"), {logIndex: 0}),
            transferLog(wei("40"), {logIndex: 1}),
        ]), makeTx())
        assert.equal((await validate("70")).valid, true)
        assert.equal((await validate("70.000000000000000001")).valid, undefined)
    })

    it("rejects Transfer to a non-zero address", async () => {
        setChain(makeReceipt([transferLog(wei("70"), {to: STRANGER})]), makeTx())
        assert.equal((await validate("70")).valid, undefined)
    })

    it("rejects Transfer from an address other than tx.from", async () => {
        setChain(makeReceipt([transferLog(wei("70"), {from: STRANGER})]), makeTx())
        assert.equal((await validate("70")).valid, undefined)
    })

    it("rejects a call other than customBurn", async () => {
        // transfer(recipient, amount) has an address as the 2nd argument too
        const data = iface.encodeFunctionData("transfer", [DEST, wei("70")])
        setChain(makeReceipt([transferLog(wei("70"))]), makeTx({data}))
        assert.equal((await validate("70")).valid, undefined)
    })

    it("rejects tx with unknown selector", async () => {
        setChain(makeReceipt([transferLog(wei("70"))]), makeTx({data: "0xdeadbeef"}))
        const res = await validate("70")
        assert.equal(res.valid, undefined)
        assert.equal(res.retry, undefined)
    })

    it("rejects customBurn to another destination", async () => {
        setChain(makeReceipt([transferLog(wei("70"))]), makeTx({data: customBurnData(wei("70"), STRANGER)}))
        assert.equal((await validate("70")).valid, undefined)
    })

    it("accepts destination address in any case", async () => {
        setChain(makeReceipt([transferLog(wei("70"))]), makeTx())
        assert.equal((await validate("70", DEST.toUpperCase().replace("0X", "0x"))).valid, true)
    })

    it("treats unparsable token contract log as invalid, not retry", async () => {
        setChain(makeReceipt([
            transferLog(wei("70"), {logIndex: 0}),
            {address: CONTRACT, logIndex: 1, topics: ["0x" + "11".repeat(32)], data: "0x"},
        ]), makeTx())
        const res = await validate("70")
        assert.equal(res.valid, undefined)
        assert.equal(res.retry, undefined)
    })

    it("treats malformed claimed amount as invalid, not retry", async () => {
        setChain(makeReceipt([transferLog(wei("70"))]), makeTx())
        for (const amount of ["1e+21", "-70", "", "abc", null, "70.0000000000000000001"]) {
            const res = await validate(amount)
            assert.equal(res.valid, undefined, `amount ${amount}`)
            assert.equal(res.retry, undefined, `amount ${amount}`)
        }
    })

    it("rejects tx sent to another contract", async () => {
        setChain(makeReceipt([transferLog(wei("70"))], {to: OTHER_CONTRACT}), makeTx({to: OTHER_CONTRACT}))
        assert.equal((await validate("70")).valid, undefined)
    })

    it("rejects failed tx", async () => {
        setChain(makeReceipt([transferLog(wei("70"))], {status: 0}), makeTx())
        assert.equal((await validate("70")).valid, undefined)
    })

    it("rejects tx mined before the swap was created", async () => {
        setChain(makeReceipt([transferLog(wei("70"))]), makeTx())
        chain.block.timestamp = SWAP_TIME.getTime() / 1000 - 60
        assert.equal((await validate("70")).valid, undefined)
    })

    it("retries when receipt or tx is not available yet", async () => {
        setChain(null, makeTx())
        assert.equal((await validate("70")).retry, true)
        setChain(makeReceipt([transferLog(wei("70"))]), null)
        assert.equal((await validate("70")).retry, true)
    })

    it("retries on provider error", async () => {
        setChain(makeReceipt([transferLog(wei("70"))]), makeTx())
        mock.method(ethers.providers.JsonRpcProvider.prototype, "getTransaction", async () => {
            throw new Error("network down")
        })
        assert.equal((await validate("70")).retry, true)
    })
})

describe("parseAmount", () => {
    it("parses MySQL DECIMAL(36,18) strings", () => {
        assert.equal(bsc.parseAmount("5000000.000000000000000000").toString(), "5000000000000000000000000")
        assert.equal(bsc.parseAmount("0.000000000000000001").toString(), "1")
        assert.equal(bsc.parseAmount("123456789012345678.123456789012345678").toString(),
            "123456789012345678123456789012345678")
        assert.equal(bsc.parseAmount(70).toString(), wei("70").toString())
    })

    it("throws on malformed or non-positive amounts", () => {
        for (const amount of ["1e+21", 1e21, "-1", "0", "0.000000000000000000", "", " 1", "1.", ".5",
            "1.0000000000000000001", null, undefined, {}]) {
            assert.throws(() => bsc.parseAmount(amount), undefined, `amount ${amount}`)
        }
    })
})

describe("isTxConfirmed", () => {
    afterEach(() => {
        process.env.BSC_CONFIRMATIONS_BLOCKS = undefined
        delete process.env.BSC_CONFIRMATIONS_BLOCKS
    })

    it("compares confirmations numerically", async () => {
        process.env.BSC_CONFIRMATIONS_BLOCKS = "15"
        assert.equal(await bsc.isTxConfirmed({confirmations: 9}), false)
        assert.equal(await bsc.isTxConfirmed({confirmations: 15}), true)
        assert.equal(await bsc.isTxConfirmed({confirmations: 100}), true)
        assert.equal(await bsc.isTxConfirmed(null), false)
    })

    it("is not confirmed when the setting is missing or empty", async () => {
        assert.equal(await bsc.isTxConfirmed({confirmations: 100}), false)
        process.env.BSC_CONFIRMATIONS_BLOCKS = ""
        assert.equal(await bsc.isTxConfirmed({confirmations: 100}), false)
    })
})
