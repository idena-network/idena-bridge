const {
    default: axios
} = require('axios');
const ethers = require('ethers');
const abi = require('./abi.js');
const InputDataDecoder = require('ethereum-input-data-decoder');
require('dotenv').config();


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
        if (idenaPrice == 0) {
            return null
        }
        let fees = ethers.utils.parseUnits((await provider.getGasPrice() * await contract.estimateGas.mint(address, amount) / idenaPrice).toString(), 'ether').div(ethers.BigNumber.from(100)).mul(ethers.BigNumber.from(process.env.BSC_FEES));
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
            return false
        }
        if (txReceipt.logs.length === 0) {
            return false
        }
        if (txReceipt.to.toLowerCase() !== process.env.BSC_CONTRACT.toLowerCase()) {
            return false
        }
        let tx = await provider.getTransaction(txHash)
        let destAddress = tx && extractDestAddress(tx.data)
        if (destAddress.toLowerCase() !== address.toLowerCase().slice(2)) {
            return false
        }
        if (contract.interface.parseLog(txReceipt.logs[0]).name !== "Transfer") {
            return false
        }
        if (!(contract.interface.parseLog(txReceipt.logs[0]).args.value >= ethers.utils.parseEther(amount.toString()))) {
            return false
        }
        if (contract.interface.parseLog(txReceipt.logs[0]).args.from.toLowerCase() !== tx.from.toLowerCase()) {
            return false
        }
        if (contract.interface.parseLog(txReceipt.logs[0]).args.to.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
            return false
        }
        return true
    } catch (error) {
        console.log("Failed to check if burn tx is valid", error);
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