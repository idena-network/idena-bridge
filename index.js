const express = require('express'),
    app = express(),
    mysql = require('mysql2'),
    cors = require('cors'),
    bodyParser = require('body-parser'),
    idena = require('./idena'),
    bsc = require('./bsc');

const logger = require('./logger').child({component: "processing"})
logger.info('Idena bridge started')
console.log('Idena bridge started')

db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: 'UTC'
});

async function handleIdenaToBscSwap(swap, conP, logger) {
    if (!await idena.isTxExist(swap.idena_tx)) {
        let date = Date.parse(swap.time);
        date.setDate(date.getDate() + 1);
        if (date < Date.now()) {
            logger.info("Swap is outdated")
            await conP.execute("UPDATE `swaps` SET `status` = 'Fail' ,`fail_reason` = 'Time' WHERE `uuid` = ?", [swap.uuid])
        }
        logger.trace("Swap skipped")
        return
    }
    if (!await idena.isValidSendTx(swap.idena_tx, swap.address, swap.amount, swap.time)) {
        // not valid
        logger.info("Idena tx is invalid")
        await conP.execute("UPDATE `swaps` SET `status` = 'Fail' ,`fail_reason` = 'Not Valid' WHERE `uuid` = ?", [swap.uuid])
        return
    }
    if (!await idena.isNewTx(swap.idena_tx)) {
        // not new
        logger.info("Idena tx already used")
        await conP.execute("UPDATE `swaps` SET `status` = 'Fail' ,`fail_reason` = 'Not Valid' WHERE `uuid` = ?", [swap.uuid])
        return
    }
    if (!await idena.isTxConfirmed(swap.idena_tx)) {
        // waiting to be confirmed
        logger.debug("Idena tx is not confirmed")
        await conP.execute("UPDATE `swaps` SET `mined` = '0' WHERE `uuid` = ?", [swap.uuid])
        return
    }
    if (!await idena.isTxActual(swap.idena_tx, swap.time)) {
        // not valid (not actual)
        logger.info("Idena tx is not actual")
        await conP.execute("UPDATE `swaps` SET `status` = 'Fail' ,`fail_reason` = 'Not Valid' WHERE `uuid` = ?", [swap.uuid])
        return
    }
    // confirmed
    const [data] = await conP.execute("INSERT INTO `used_txs`(`blockchain`,`tx_hash`) VALUES ('idena',?);", [swap.idena_tx]);
    if (!data.insertId) {
        logger.error("Unable to insert used idena tx")
        return
    }
    let {
        hash,
        fees
    } = await bsc.mint(swap.address, swap.amount);
    if (!hash) {
        logger.error("Unable to mint bsc coins")
        await conP.execute("UPDATE `swaps` SET `status` = 'Fail' ,`mined` = '1' ,`fail_reason` = 'Unknown' WHERE `uuid` = ?", [swap.uuid])
        return
    }
    logger.info(`Swap completed, bsc tx hash: ${hash}, fees: ${fees}`)
    await conP.execute("UPDATE `swaps` SET `status` = 'Success' ,`mined` = '1' ,`bsc_tx` = ? ,`fees` = ? WHERE `uuid` = ?", [hash, fees, swap.uuid])
}

async function handleBscToIdenaSwap(swap, conP, logger) {
    if (!await bsc.isValidBurnTx(swap.bsc_tx, swap.address, swap.amount, swap.time)) {
        // not valid
        logger.info("BSC tx is invalid")
        await conP.execute("UPDATE `swaps` SET `status` = 'Fail' , `mined` = '2' , `fail_reason` = 'Not Valid' WHERE `uuid` = ?", [swap.uuid])
    }
    if (!await bsc.isNewTx(swap.bsc_tx)) {
        // not new
        logger.info("BSC tx already used")
        await conP.execute("UPDATE `swaps` SET `status` = 'Fail' , `mined` = '2' , `fail_reason` = 'Not Valid' WHERE `uuid` = ?", [swap.uuid])
    }
    if (!await bsc.isTxConfirmed(swap.bsc_tx)) {
        // waiting to be confirmed
        logger.debug("BSC tx is not confirmed")
        await conP.execute("UPDATE `swaps` SET `mined` = '0' WHERE `uuid` = ?", [swap.uuid])
    }
    // confirmed
    const [data2] = await conP.execute("INSERT INTO `used_txs`(`blockchain`,`tx_hash`) VALUES ('bsc',?);", [swap.bsc_tx]);
    if (!data2.insertId) {
        logger.error("Unable to insert used BSC tx")
        return
    }
    let {
        hash,
        fees,
        errorMessage
    } = await idena.send(swap.address, swap.amount);
    if (!hash) {
        const reason = errorMessage ? errorMessage : 'Unknown'
        logger.error(`Unable to send idena tx: ${reason}`)
        await conP.execute("UPDATE `swaps` SET `status` = 'Fail' ,`mined` = '1' ,`fail_reason` = ? WHERE `uuid` = ?", [reason, swap.uuid])
        return
    }
    logger.info(`Swap completed, idena tx hash: ${hash}`)
    await conP.execute("UPDATE `swaps` SET `status` = 'Success' ,`mined` = '1' ,`idena_tx` = ? , `fees` = ? WHERE `uuid` = ?", [hash, fees, swap.uuid])
}

async function handleSwap(swap, conP, logger) {
    if (swap.type === 0 && swap.idena_tx) {
        await handleIdenaToBscSwap(swap, conP, logger)
        return
    }

    if (swap.type === 1 && swap.bsc_tx) {
        await handleBscToIdenaSwap(swap, conP, logger)
        return
    }

    let date = new Date(swap.time);
    date.setDate(date.getDate() + 1);
    if (date < Date.now()) {
        logger.info("Swap is outdated")
        await conP.execute("UPDATE `swaps` SET `status` = 'Fail' , `mined` = '2' ,`fail_reason` = 'Time' WHERE `uuid` = ?", [swap.uuid])
    }
    logger.trace("Swap skipped")
}

async function checkSwaps() {
    logger.trace("Starting to check swaps")
    let conP = db.promise();
    let sql = "SELECT * FROM `swaps` WHERE `status` = 'Pending';";
    let data
    try {
        [data] = await conP.execute(sql);
    } catch (error) {
        logger.error(`Failed to load pending swaps: ${error}`);
        return
    }
    if (!data.length) {
        return
    }
    logger.trace(`Starting to handle pending swaps, cnt: ${data.length}`)
    for (swap of data) {
        const swapLogger = logger.child({swapId: swap.uuid})
        try {
            await handleSwap(swap, conP, swapLogger)
        } catch (error) {
            swapLogger.error(`Failed to handle swap: ${error}`);
        }
    }
}

async function loopCheckSwaps() {
    await checkSwaps();
    setTimeout(loopCheckSwaps, parseInt(process.env.CHECKING_DELAY));
}

const swaps = require('./routes/swaps');
app.use(cors())
app.use(bodyParser.json());
app.use('/swaps', swaps);

async function start() {
    await idena.initNonce()
    loopCheckSwaps();
    const port = 8000;
    app.listen(port, () => logger.info(`Server started, listening on port: ${port}`));
}

start()