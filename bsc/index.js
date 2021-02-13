const {
    default: axios
} = require('axios');
const {
    ethers
} = require('ethers'),
    fs = require('fs');
const {
    METHODS
} = require('http');
const abi = require('./abi.js');
require('dotenv').config();


exports.mint = async function (address, amount) {
    try {
        amount = ethers.utils.parseEther((parseFloat(amount) - parseFloat(process.env.BSC_FEE)).toString());
        const provider = new ethers.providers.JsonRpcProvider(process.env.BSC_RPC, parseInt(process.env.BSC_NETWORK));
        const signer = new ethers.Wallet(process.env.BSC_PRIVATE_KEY, provider);
        const contract = new ethers.Contract(
            process.env.BSC_CONTRACT,
            abi,
            signer
        );
        let idenaPrice = await getIdenaPrice();
        if (idenaPrice == 0) {
            return null
        }
        let fees = ethers.utils.parseUnits((await provider.getGasPrice() * await contract.estimateGas.mint(address, amount) / idenaPrice).toString(), 'ether')
        return {
            hash: (await contract.mint(address, amount.sub(fees))).hash,
            fees: parseFloat(fees / 10 ** 18)
        }
    } catch (error) {
        console.log(error);
        return null
    }

}
exports.isValidBurnTx = async function (txHash, address, amount) {
    try {
        const provider = new ethers.providers.JsonRpcProvider(process.env.BSC_RPC, parseInt(process.env.BSC_NETWORK));
        const contract = new ethers.Contract(
            process.env.BSC_CONTRACT,
            abi
        );
        let tx = await provider.getTransactionReceipt(txHash);
        if (tx.status !== 1) {
            return false
        } else if (tx.logs.length == 0) {
            return false
        } else if (tx.from.toLowerCase() !== address.toLowerCase()) {
            return false
        } else if (tx.to.toLowerCase() !== process.env.BSC_CONTRACT.toLowerCase()) {
            return false
        } else if (contract.interface.parseLog(tx.logs[0]).name !== "Transfer") {
            return false
        } else if (!(contract.interface.parseLog(tx.logs[0]).args.value >= ethers.utils.parseEther(amount.toString()))) {
            return false
        } else if (contract.interface.parseLog(tx.logs[0]).args.from.toLowerCase() !== address.toLowerCase()) {
            return false
        } else if (contract.interface.parseLog(tx.logs[0]).args.to.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
            return false
        } else {
            return true
        }
    } catch (error) {
        console.log(error);
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
        console.log(error);
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
        console.log(error);
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
    if (resp.status == 200 && resp.data.idena.bnb) {
        return ethers.utils.parseEther(resp.data.idena.bnb.toString());
    } else {
        return 0
    }
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
        console.log(error);
        return false
    }
}
