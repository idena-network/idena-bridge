const {
        Transaction,
        privateKeyToAddress
    } = require('./script.js'),
    axios = require("axios"),
    fs = require('fs'),
    path = require('path');
require('dotenv').config();
const logger = require('../logger').child({component: "idena"})

const nonceDir = process.env.NONCE_DIR
const nonceFile = path.join(nonceDir || '', 'nonce.json')

async function setNonce() {
    try {
        const apiEpochResp = await axios.post(process.env.IDENA_PROVIDER, {
            "method": "dna_epoch",
            "id": 1,
            "key": process.env.IDENA_API_KEY,
            "params": []
        })
        let apiBalanceResp = await axios.post(process.env.IDENA_PROVIDER, {
            "method": "dna_getBalance",
            "id": 1,
            "key": process.env.IDENA_API_KEY,
            "params": [privateKeyToAddress(process.env.IDENA_PRIVATE_KEY)]
        })
        fs.writeFileSync(nonceFile, JSON.stringify({
            nonce: apiBalanceResp.data.result.nonce,
            epoch: apiEpochResp.data.result.epoch
        }), "utf8")
        const msg = "The idena local nonce has has been set"
        logger.info(msg);
        console.log(msg)
    } catch (error) {
        const msg = `Error while trying to set the idena local nonce: ${error}`
        logger.error(msg);
        console.error(msg)
        throw error
    }
}

exports.initNonce = async function () {
    if (nonceDir && !fs.existsSync(nonceDir)) {
        fs.mkdirSync(nonceDir, {recursive: true});
        const msg = `Directory for nonce file created: ${nonceDir}`
        logger.info(msg)
        console.log(msg)
    }
    if (!fs.existsSync(nonceFile)) {
        await setNonce()
    }
}

exports.send = async function (address, amount, takeFee) {
    try {
        let epoch = await getEpoch();
        let nonce = await getNonce(epoch);
        if (nonce !== null && epoch !== null) {
            if (takeFee) {
                amount = parseFloat(amount) - parseFloat(process.env.IDENA_FIXED_FEES)
            } else {
                amount = parseFloat(amount)
            }
            logger.info(`Sending idena tx, address: ${address}, amount: ${amount}, epoch: ${epoch}, nonce: ${nonce}`)
            const tx = await new Transaction(
                nonce,
                epoch,
                0,
                address,
                amount * 10 ** 18,
                0.5 * 10 ** 18,
                0 * 10 ** 18,
                null
            );
            let apiResp = await axios.post(process.env.IDENA_PROVIDER, {
                "method": "bcn_sendRawTx",
                "id": 1,
                "key": process.env.IDENA_API_KEY,
                "params": [tx.sign(process.env.IDENA_PRIVATE_KEY).toHex()]
            })
            return {
                hash: apiResp.data.result,
                fees: parseFloat(process.env.IDENA_FIXED_FEES),
                errorMessage: apiResp.data.error && apiResp.data.error.message
            } || null;
        } else {
            return null
        }

    } catch (error) {
        logger.error(`Failed to send tx: ${error}`);
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
        logger.error(`Failed to get tx: ${error}`);
        return null
    }
}

exports.isTxConfirmed = async function (tx) {
    try {
        let transaction = await getTransaction(tx);
        if (!transaction.timestamp) {
            return false
        }
        let bcn_block = await axios.post(process.env.IDENA_PROVIDER, {
            "method": "bcn_block",
            "id": 1,
            "key": process.env.IDENA_API_KEY,
            "params": [transaction.blockHash]
        })
        let bcn_syncing = await axios.post(process.env.IDENA_PROVIDER, {
            "method": "bcn_syncing",
            "id": 1,
            "key": process.env.IDENA_API_KEY,
            "params": []
        });
        return bcn_syncing.data.result.highestBlock > bcn_block.data.result.height + parseInt(process.env.IDENA_CONFIRMATIONS_BLOCKS) || false
    } catch (error) {
        logger.error(`Failed to check if tx is confirmed: ${error}`);
        return false
    }
}

exports.isTxActual = async function (txHash, date) {
    try {
        const transaction = await getTransaction(txHash);
        return await isTxActual(transaction, date)
    } catch (error) {
        logger.error(`Failed to check if tx is actual: ${error}`);
        return false
    }
}

async function isTxActual(tx, date) {
    try {
        return new Date(tx.timestamp * 1000).getTime() >= date.getTime()
    } catch (error) {
        logger.error(`Failed to check if tx is actual: ${error}`);
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
        logger.error(`Failed to get epoch: ${error}`);
        return null
    }
}

async function getNonce(epoch) {
    try {
        if (fs.existsSync(nonceFile)) {
            const current = JSON.parse(fs.readFileSync(nonceFile))
            let newEpoch = current.epoch
            let newNonce = current.nonce + 1;
            if (epoch > newEpoch) {
                newEpoch = epoch
                newNonce = 1
            }
            fs.writeFileSync(nonceFile, JSON.stringify({
                nonce: newNonce,
                epoch: newEpoch
            }), "utf8")
            return newNonce || null;
        } else {
            return null
        }
    } catch (error) {
        logger.error(`Failed to get nonce: ${error}`);
        return null
    }
}

exports.isValidSendTx = async function (txHash, address, amount, date) {
    function extractDestAddress(payload) {
        try {
            const comment = Buffer.from(payload.substring(2), 'hex').toString()
            const prefix = "BSCADDRESS"
            if (comment.indexOf(prefix) !== 0) {
                return false
            }
            return comment.substring(prefix.length)
        } catch (error) {
            logger.error(`Failed to extract dest address: ${error}`);
            return false
        }
    }

    try {
        let transaction = await getTransaction(txHash);
        if (!transaction) {
            logger.info("No tx");
            return false
        }
        const destAddress = extractDestAddress(transaction.payload)
        if (!destAddress || destAddress.toLowerCase() !== address.toLowerCase()) {
            logger.info(`Wrong dest address, actual: ${destAddress}, expected: ${address}`);
            return false
        }
        const recipient = privateKeyToAddress(process.env.IDENA_PRIVATE_KEY)
        if (transaction.to !== recipient) {
            logger.info(`Wrong tx recipient, actual: ${transaction.to}, expected: ${recipient}`);
            return false
        }
        if (!(parseFloat(transaction.amount) >= parseFloat(amount))) {
            logger.info(`Wrong tx amount, actual: ${transaction.amount}, expected: at least ${amount}`);
            return false
        }
        if (transaction.type !== "send") {
            logger.info(`Wrong tx type, actual: ${transaction.type}, expected: send`);
            return false
        }
        if (transaction.timestamp && !await isTxActual(transaction, date)) {
            logger.info("Tx is not actual");
            return false
        }
        return true
    } catch (error) {
        logger.error(`Failed to check if idena tx is valid: ${error}`);
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
        logger.error(`Failed to check if tx exists: ${error}`);
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
        logger.error(`Failed to check if tx is new: ${error}`);
        return false
    }
}