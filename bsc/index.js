const {
    default: axios
} = require('axios');
const ethers = require('ethers');
const abi = require('./abi.js');
require('dotenv').config();
const logger = require('../logger').child({
    component: "bsc"
})

exports.estimateMint = async function (address, amount) {
    try {
        amount = ethers.utils.parseEther((parseFloat(amount)).toString());
        const provider = new ethers.providers.JsonRpcProvider(process.env.BSC_RPC, parseInt(process.env.BSC_NETWORK));
        const signer = new ethers.Wallet(process.env.BSC_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(
            process.env.BSC_CONTRACT,
            abi,
            signer
        );
        const idenaPrice = await getIdenaPrice();
        if (!idenaPrice) {
            return null
        }
        const fees = ethers.utils.parseUnits((await provider.getGasPrice() * await contract.estimateGas.mint(address, amount) / idenaPrice).toString(), 'ether').div(ethers.BigNumber.from(100)).mul(ethers.BigNumber.from(process.env.BSC_FEES));
        return {
            contract: contract,
            amount: amount,
            fees: fees
        }
    } catch (error) {
        logger.error(`Failed to estimate mint: ${error}`);
        return null
    }
}

exports.mint = async function (contract, address, amount, fees, nonce) {
    try {
        const amountToMint = amount.sub(fees)
        logger.debug(`Start minting, address: ${address}, base amount: ${amount}, fee: ${fees}, amount to mint: ${amountToMint}, nonce: ${nonce}`)
        const res = nonce ? await contract.mint(address, amountToMint, {nonce: nonce}) : await contract.mint(address, amountToMint)
        return {
            hash: res.hash,
            nonce: res.nonce,
            gasPrice: res.gasPrice,
            gasLimit: res.gasLimit,
            fees: parseFloat(fees / 10 ** 18)
        }
    } catch (error) {
        logger.error(`Failed to mint: ${error}`);
        return {}
    }
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
const AMOUNT_REGEX = /^\d+(\.\d{1,18})?$/

// Converts a swap amount (MySQL DECIMAL(36,18) string, e.g. "18800000.000000000000000000") to wei.
// Throws on anything that is not a plain positive decimal with at most 18 fractional digits.
function parseAmount(amount) {
    if (typeof amount !== 'string' && typeof amount !== 'number') {
        throw new Error(`unsupported amount type: ${typeof amount}`)
    }
    const str = amount.toString()
    if (!AMOUNT_REGEX.test(str)) {
        throw new Error(`invalid amount: ${str}`)
    }
    const res = ethers.utils.parseEther(str)
    if (!res.gt(ethers.constants.Zero)) {
        throw new Error(`non-positive amount: ${str}`)
    }
    return res
}

exports.parseAmount = parseAmount

// Checks the already fetched receipt and tx. Returns an error description or null if the tx is a valid burn.
// Any exception thrown here means malformed data and is treated by the caller as an invalid tx (no retry).
function getBurnTxError(txReceipt, tx, address, amount) {
    const contractAddress = process.env.BSC_CONTRACT.toLowerCase()
    if (txReceipt.status !== 1) {
        return `Wrong status, actual: ${txReceipt.status}, expected: 1`
    }
    if (!txReceipt.to || txReceipt.to.toLowerCase() !== contractAddress) {
        return `Wrong recipient, actual: ${txReceipt.to}, expected: ${process.env.BSC_CONTRACT}`
    }
    if (!tx.to || tx.to.toLowerCase() !== contractAddress) {
        return `Wrong tx recipient, actual: ${tx.to}, expected: ${process.env.BSC_CONTRACT}`
    }
    if (!txReceipt.transactionHash || !tx.hash || txReceipt.transactionHash.toLowerCase() !== tx.hash.toLowerCase()) {
        return `Receipt does not match tx, receipt: ${txReceipt.transactionHash}, tx: ${tx.hash}`
    }

    const contractInterface = new ethers.utils.Interface(abi)
    let call
    try {
        call = contractInterface.parseTransaction({data: tx.data})
    } catch (error) {
        return `Unable to parse tx data: ${error}`
    }
    if (call.sighash !== contractInterface.getSighash("customBurn")) {
        return `Wrong method, actual: ${call.name}, expected: customBurn`
    }
    const destAddress = call.args.destination
    if (destAddress.toLowerCase() !== ethers.utils.getAddress(address).toLowerCase()) {
        return `Wrong dest address, actual: ${destAddress}, expected: ${address}`
    }

    // Sum all Transfer(tx.from -> 0x0) events emitted by the token contract; logs of other contracts are ignored.
    const expectedValue = parseAmount(amount)
    let burntValue = ethers.constants.Zero
    let burnLogsCount = 0
    for (const log of txReceipt.logs || []) {
        if (!log.address || log.address.toLowerCase() !== contractAddress) {
            continue
        }
        let event
        try {
            event = contractInterface.parseLog(log)
        } catch (error) {
            return `Unable to parse token contract log ${log.logIndex}: ${error}`
        }
        if (event.name !== "Transfer") {
            continue
        }
        if (event.args.from.toLowerCase() !== tx.from.toLowerCase() || event.args.to.toLowerCase() !== ZERO_ADDRESS) {
            continue
        }
        burntValue = burntValue.add(event.args.value)
        burnLogsCount++
    }
    if (burnLogsCount === 0) {
        return `No burn Transfer logs from ${tx.from} to ${ZERO_ADDRESS}`
    }
    if (burntValue.lt(expectedValue)) {
        return `Wrong value, actual: ${burntValue}, expected: at least ${expectedValue}`
    }
    return null
}

exports.validateBurnTx = async function (txReceipt, txHash, address, amount, date) {
    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.BSC_RPC, parseInt(process.env.BSC_NETWORK));
        if (!txReceipt) {
            txReceipt = await provider.getTransactionReceipt(txHash);
        }
        if (!txReceipt) {
            logger.info(`Unable to get tx receipt, hash: ${txHash}`);
            return {
                retry: true
            }
        }

        let tx = await provider.getTransaction(txHash)
        if (!tx) {
            logger.info(`Unable to get tx, hash: ${txHash}`);
            return {
                retry: true
            }
        }
        let txError
        try {
            txError = getBurnTxError(txReceipt, tx, address, amount)
        } catch (error) {
            txError = `Malformed burn tx: ${error}`
        }
        if (txError) {
            logger.info(`Invalid burn tx ${txHash}: ${txError}`);
            return {}
        }
        const block = await provider.getBlock(tx.blockHash)
        if (!block) {
            logger.info(`Unable to get block, hash: ${tx.blockHash}`);
            return {
                retry: true
            }
        }
        const blockDate = new Date(block.timestamp * 1000);
        if (blockDate.getTime() < date.getTime()) {
            logger.info("Tx is not actual");
            return {}
        }
        return {
            valid: true,
            txReceipt: txReceipt,
        }
    } catch (error) {
        logger.error(`Failed to check if burn tx is valid: ${error}`);
        return {
            retry: true
        }
    }
}

exports.getTransactionReceipt = async function (txHash) {
    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.BSC_RPC, parseInt(process.env.BSC_NETWORK));
        return await provider.getTransactionReceipt(txHash);
    } catch (error) {
        logger.error(`Failed to get transaction ${txHash} receipt: ${error}`);
        return null
    }
}

exports.isTxConfirmed = async function (txReceipt) {
    try {
        const requiredConfirmations = parseInt(process.env.BSC_CONFIRMATIONS_BLOCKS)
        if (isNaN(requiredConfirmations)) {
            logger.error(`Invalid BSC_CONFIRMATIONS_BLOCKS: ${process.env.BSC_CONFIRMATIONS_BLOCKS}`);
            return false
        }
        return !!txReceipt && txReceipt.confirmations >= requiredConfirmations;
    } catch (error) {
        logger.error(`Failed to check if tx is confirmed: ${error}`);
        return false
    }

}

exports.getWalletAddress = async function () {
    const signer = new ethers.Wallet(process.env.BSC_PRIVATE_KEY);
    return await signer.getAddress();
}

exports.getContractAddress = function () {
    return process.env.BSC_CONTRACT;
}

async function getIdenaPrice() {
    const coinmarketcapPrice = async function() {
        let resp = await axios.get("https://pro-api.coinmarketcap.com/v2/tools/price-conversion?id=5836&convert_id=1839&amount=1", {
            headers: {
                'X-CMC_PRO_API_KEY': process.env.PRICE_API_KEY,
            },
        });
        if (resp.status !== 200) {
            logger.error(`Failed to get idena price, status: ${resp.status}`);
            return 0
        }
        const price = resp.data.data.quote['1839'].price
        if (!price) {
            logger.error(`Failed to get idena price, res: ${resp.data}`);
            return 0
        }
        return ethers.utils.parseEther(price.toFixed(18).toString());
    }

    const coingeckoPrice = async function() {
        let resp = await axios.get("https://api.coingecko.com/api/v3/simple/price?ids=idena&vs_currencies=bnb");
        if (resp.status !== 200) {
            logger.error(`Failed to get idena price, status: ${resp.status}`);
            return 0
        }
        if (!resp.data.idena.bnb) {
            logger.error(`Failed to get idena price, res: ${resp.data.idena.bnb}`);
            return 0
        }
        return ethers.utils.parseEther(resp.data.idena.bnb.toString());
    }

    let res
    try {
        res =  await coinmarketcapPrice()
    } catch (e) {
        res =  await coingeckoPrice()
    }

    return res
}

exports.isNewTx = async function (tx) {
    try {
        const [data] = await db.promise().execute("SELECT `id` FROM `used_txs` WHERE `tx_hash` = ? AND `blockchain` = 'bsc';", [tx]);
        if (data[0]) {
            return false
        } else {
            return true
        }
    } catch (error) {
        logger.error(`Failed to check if tx is new: ${error}`);
        return false
    }
}

exports.calculateFees = async function (address, amount) {
    try {
        amount = ethers.utils.parseEther((parseFloat(amount)).toString());
        const provider = new ethers.providers.JsonRpcProvider(process.env.BSC_RPC, parseInt(process.env.BSC_NETWORK));
        const signer = new ethers.Wallet(process.env.BSC_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(
            process.env.BSC_CONTRACT,
            abi,
            signer
        );
        let idenaPrice = await getIdenaPrice();
        if (!idenaPrice) {
            return {}
        }
        let fees = ethers.utils.parseUnits((await provider.getGasPrice() * await contract.estimateGas.mint(address, amount) / idenaPrice).toString(), 'ether').div(ethers.BigNumber.from(100)).mul(ethers.BigNumber.from(process.env.BSC_FEES));
        return parseFloat(fees / 10 ** 18);

    } catch (error) {
        logger.error(`Failed to calculate fees: ${error}`);
        return {}
    }
}

let tokenSupply

exports.loopTokenSupplyRefreshing = async function () {
    try {
        const res = await getTokenSupply()
        if (res) {
            tokenSupply = res
            logger.trace(`Cached token supply refreshed: ${tokenSupply}`);
        }
    } catch (error) {
        logger.error(`Failed to refresh token supply: ${error}`);
    }
    setTimeout(exports.loopTokenSupplyRefreshing, 60000);
}

exports.tokenSupply = async function () {
    let res = tokenSupply
    if (res) {
        return res
    }
    return await getTokenSupply()
}

exports.getNonce = async function () {
    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.BSC_RPC, parseInt(process.env.BSC_NETWORK));
        const signer = new ethers.Wallet(process.env.BSC_PRIVATE_KEY, provider);
        return await signer.getTransactionCount()
    } catch (error) {
        logger.error(`Failed to get nonce: ${error}`);
        return null
    }
}

async function getTokenSupply() {
    let resp = await axios.get(`https://api.bscscan.com/api?module=stats&action=tokensupply&contractaddress=${process.env.BSC_CONTRACT}`);
    if (!resp) {
        logger.error(`Failed to get token supply: no response`);
        return false
    }
    if (resp.status !== 200) {
        logger.error(`Failed to get token supply, status: ${resp.status}`);
        return false
    }
    if (!resp.data) {
        logger.error(`Failed to get token supply: no data in response`);
        return false
    }
    if (resp.data.message !== "OK") {
        logger.error(`Failed to get token supply, non-ok message: ${resp.data.result}`);
        return false
    }
    const res = resp.data.result
    logger.info(`Got token supply: ${res}`);
    return res
}
