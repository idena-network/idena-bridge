const {
    Transaction,
    privateKeyToAddress
} = require('./script.js'),
    axios = require("axios"),
    fs = require('fs');
require('dotenv').config();

exports.send = async function (address, amount) {
    try {
        let epoch = await getEpoch();
        let nonce = await getNonce();
        if (nonce !== null && epoch !== null) {
            amount = parseFloat(amount) - parseFloat(process.env.IDENA_FIXED_FEES)
            const tx = await new Transaction(
                nonce,
                epoch,
                0,
                address,
                amount * 10 ** 18,
                0.5 * 10 ** 18,
                0 * 10 ** 18,
                Buffer.from("IDENA-TO-THE-MOON").toString('hex')
            );
            let apiResp = await axios.post(process.env.IDENA_PROVIDER, {
                "method": "bcn_sendRawTx",
                "id": 1,
                "key": process.env.IDENA_API_KEY,
                "params": [tx.sign(process.env.IDENA_PRIVATE_KEY).toHex()]
            })
            return {
                hash: apiResp.data.result,
                fees: parseFloat(process.env.IDENA_FIXED_FEES)
            } || null;
        } else {
            return null
        }

    } catch (error) {
        console.log(error);
        return null
    }

}
async function getTransaction(tx) {
    try {
        let transaction = await axios.post(process.env.IDENA_PROVIDER, {
            "method": "bcn_transaction",
            "id": 1,
            "key": process.env.IDENA_API_KEY,
            "params": [tx]
        });
        return transaction.data.result || null
    } catch (error) {
        console.log(error);
        return null
    }
}
exports.isTxConfirmed = async function (tx) {
    try {
        let transaction = await axios.post(process.env.IDENA_PROVIDER, {
            "method": "bcn_transaction",
            "id": 1,
            "key": process.env.IDENA_API_KEY,
            "params": [tx]
        });
        if (transaction.data.result.timestamp) {
            let bcn_block = await axios.post(process.env.IDENA_PROVIDER, {
                "method": "bcn_block",
                "id": 1,
                "key": process.env.IDENA_API_KEY,
                "params": [transaction.data.result.blockHash]
            });
            let bcn_syncing = await axios.post(process.env.IDENA_PROVIDER, {
                "method": "bcn_syncing",
                "id": 1,
                "key": process.env.IDENA_API_KEY,
                "params": []
            });
            return bcn_syncing.data.result.highestBlock > bcn_block.data.result.height + parseInt(process.env.IDENA_CONFIRMATIONS_BLOCKS) || false
        } else {
            return false;
        }
    } catch (error) {
        console.log(error);
        return false
    }

}

async function getEpoch() {
    try {
        let apiResp = await axios.post(process.env.IDENA_PROVIDER, {
            "method": "dna_epoch",
            "id": 1,
            "key": process.env.IDENA_API_KEY,
            "params": []
        })
        return apiResp.data.result.epoch;
    } catch (error) {
        return null
    }

}
async function getNonce() {
    try {
        if (fs.existsSync("./idena/nonce.json")) {
            let newNonce = JSON.parse(fs.readFileSync('./idena/nonce.json')).nonce + 1;
            fs.writeFileSync("./idena/nonce.json", JSON.stringify({
                nonce: newNonce
            }), "utf8")
            return newNonce || null;
        } else {
            return null
        }
    } catch (error) {
        console.log(error);
        return null
    }
}

exports.isValidSendTx = async function (txHash, address, amount) {
    try {
        let transaction = await getTransaction(txHash);
        if (transaction) {
            if (transaction.to !== privateKeyToAddress(process.env.IDENA_PRIVATE_KEY)) {
                return false
            } else if (!(parseFloat(transaction.amount) >= parseFloat(amount))) {
                return false
            } else if (transaction.type !== "send") {
                return false
            } else if (transaction.from.toLowerCase() !== address.toLowerCase()) {
                return false
            } else {
                return true
            }
        } else {
            return false
        }
    } catch (error) {
        console.log(error);
        return false
    }
}

exports.isTxExist = async function (txHash) {
    try {
        let transaction = await getTransaction(txHash);
        if (transaction) {
            return true
        } else {
            return false
        }
    } catch (error) {
        console.log(error);
        return false
    }
}

exports.getWalletAddress = function () {
    return privateKeyToAddress(process.env.IDENA_PRIVATE_KEY);
}
exports.isNewTx = async function (tx) {
    try {
        const [data] = await db.promise().execute("SELECT `id` FROM `used_txs` WHERE `tx_hash` = ? AND `blockchain` = 'idena';", [tx]);
        if (data[0]) {
            return false
        } else {
            return true
        }
    } catch (error) {
        return false
    }

}