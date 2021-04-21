const {
    default: axios
} = require('axios');
const ethers = require('ethers');
const abi = require('./abi.js');
const InputDataDecoder = require('ethereum-input-data-decoder');
require('dotenv').config();
const logger = require('../logger').child({
    component: "bsc"
})


exports.mint = async function (address, amount) {
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
        let amountToMint = amount.sub(fees)
        logger.debug(`Start minting, address: ${address}, base amount: ${amount}, fee: ${fees}, amount to mint: ${amountToMint}`)
        return {
            hash: (await contract.mint(address, amountToMint)).hash,
            fees: parseFloat(fees / 10 ** 18)
        }
    } catch (error) {
        logger.error(`Failed to mint: ${error}`);
        return {}
    }
}

exports.isValidBurnTx = async function (txHash, address, amount, date) {
    function extractDestAddress(inputData) {
        try {
            if (!inputData) {
                return false
            }
            const inputDataDecoder = new InputDataDecoder(abi)
            const result = inputDataDecoder.decodeData(inputData)
            if (!result || !result.inputs || result.inputs.length < 2) {
                return false
            }
            return result.inputs[1]
        } catch (error) {
            logger.error(`Failed to extract dest address: ${error}`);
            return false
        }
    }

    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.BSC_RPC, parseInt(process.env.BSC_NETWORK));
        const contract = new ethers.Contract(
            process.env.BSC_CONTRACT,
            abi
        );

        let txReceipt = await provider.getTransactionReceipt(txHash);

        if (txReceipt.status !== 1) {
            logger.info(`Wrong status, actual: ${txReceipt.status}, expected: 1`);
            return false
        }
        if (txReceipt.logs.length === 0) {
            logger.info(`No logs`);
            return false
        }
        if (txReceipt.to.toLowerCase() !== process.env.BSC_CONTRACT.toLowerCase()) {
            logger.info(`Wrong recipient, actual: ${txReceipt.to}, expected: ${process.env.BSC_CONTRACT}`);
            return false
        }
        let tx = await provider.getTransaction(txHash)
        let destAddress = tx && extractDestAddress(tx.data)
        if (destAddress.toLowerCase() !== address.toLowerCase().slice(2)) {
            logger.info(`Wrong dest address, actual: ${destAddress}, expected: ${address}`);
            return false
        }
        const method = contract.interface.parseLog(txReceipt.logs[0]).name
        if (method !== "Transfer") {
            logger.info(`Wrong method, actual: ${method}, expected: Transfer`);
            return false
        }
        const value = contract.interface.parseLog(txReceipt.logs[0]).args.value
        if (!(value >= ethers.utils.parseEther(amount.toString()))) {
            logger.info(`Wrong value, actual: ${value}, expected: at least ${amount}`);
            return false
        }
        const from = contract.interface.parseLog(txReceipt.logs[0]).args.from
        if (from.toLowerCase() !== tx.from.toLowerCase()) {
            logger.info(`Wrong sender, actual: ${from}, expected: ${tx.from}`);
            return false
        }
        const to = contract.interface.parseLog(txReceipt.logs[0]).args.to
        if (to.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
            logger.info(`Wrong recipient, actual: ${to}, expected: 0x0000000000000000000000000000000000000000`);
            return false
        }
        const block = await provider.getBlock(tx.blockHash)
        const blockDate = new Date(block.timestamp * 1000);
        if (blockDate.getTime() < date.getTime()) {
            logger.info("Tx is not actual");
            return false
        }
        return true
    } catch (error) {
        logger.error(`Failed to check if burn tx is valid: ${error}`);
        return false
    }
}

exports.isTxExist = async function (txHash) {
    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.BSC_RPC, parseInt(process.env.BSC_NETWORK));
        let tx = await provider.getTransactionReceipt(txHash);
        if (tx) {
            return true
        } else {
            return false
        }
    } catch (error) {
        logger.error(`Failed to check if tx exists: ${error}`);
        return false
    }
}
exports.isTxConfirmed = async function (txHash) {
    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.BSC_RPC, parseInt(process.env.BSC_NETWORK));
        let tx = await provider.getTransactionReceipt(txHash);
        if (tx) {
            return tx.confirmations >= process.env.BSC_CONFIRMATIONS_BLOCKS;
        } else {
            return false
        }
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