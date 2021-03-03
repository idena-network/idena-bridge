const express = require('express'),
    router = express.Router();
const uuid = require('uuid');
const idena = require('../idena');
const bsc = require('../bsc');
const {
    utils
} = require('ethers');
const {
    ethers
} = require('ethers');
const logger = require('../logger').child({component: "api"})

router.get('/latest', async function (req, res) {
    try {
        await latest(req, res)
    } catch (error) {
        logger.error(`Failed ${req.path}: ${error}`)
        res.sendStatus(500)
    }
});

async function latest(req, res) {
    const reqInfo = req.path
    logger.debug(`Got ${reqInfo}`)
    let sql = "SELECT `address`,`type`,`amount`,`status`,`time` FROM `swaps` ORDER BY time DESC LIMIT 50;";
    db.query(sql, function (error, result, fields) {
        if (error) {
            logger.error(`Failed ${reqInfo}: ${error}`)
            res.sendStatus(500)
            return
        }
        logger.debug(`Completed ${reqInfo}`)
        res.status(200).json({
            result: result
        })
    })
}

router.get('/info/:uuid', async function (req, res) {
    try {
        await info(req, res)
    } catch (error) {
        logger.error(`Failed ${req.path}: ${error}`)
        res.sendStatus(500)
    }
});

async function info(req, res) {
    const reqInfo = req.path
    logger.debug(`Got ${reqInfo}`)
    if (!uuid.validate(req.params.uuid)) {
        logger.debug(`Bad request ${reqInfo}`)
        res.sendStatus(400);
        return
    }
    let sql = "SELECT * FROM `swaps` WHERE `uuid` = ? LIMIT 1;";
    db.promise().execute(sql, [req.params.uuid])
        .then(([data, fields]) => {
            if (!data[0]) {
                logger.debug(`Not found ${reqInfo}`)
                res.sendStatus(404);
                return
            }
            logger.debug(`Completed ${reqInfo}`)
            res.status(200).json({
                result: data[0]
            })
        })
        .catch(err => {
            logger.error(`Failed ${reqInfo}: ${err}`)
            res.sendStatus(500);
        });
}

router.post('/assign', async function (req, res) {
    try {
        await assign(req, res)
    } catch (error) {
        logger.error(`Failed ${req.path} (uuid=${req.body.uuid}): ${error}`)
        res.sendStatus(500)
    }
});

async function assign(req, res) {
    const reqInfo = `${req.path} (uuid=${req.body.uuid}, tx=${req.body.tx})`
    logger.debug(`Got ${reqInfo}`)
    if (!uuid.validate(req.body.uuid)) {
        logger.debug(`Bad request ${reqInfo}`)
        res.sendStatus(400);
        return
    }

    function reject(err) {
        logger.error(`Failed ${reqInfo}: ${err}`)
        res.sendStatus(500);
    }

    let conP = db.promise();
    let sql = "SELECT `uuid`,`amount`,`address`,`type`,`idena_tx`,`bsc_tx`, `time` FROM `swaps` WHERE `uuid` = ? LIMIT 1;";
    let data
    try {
        [data] = await conP.execute(sql, [req.body.uuid]);
    } catch (err) {
        reject(err)
        return
    }

    if (data[0] && data[0].type === 0 && !(data[0].idena_tx) && ethers.utils.isHexString(req.body.tx) && req.body.tx.length === 66) {
        if (await idena.isTxExist(req.body.tx)) {
            if (await idena.isValidSendTx(req.body.tx, data[0].address, data[0].amount, data[0].time) && await idena.isNewTx(req.body.tx)) {
                sql = "UPDATE `swaps` SET `idena_tx` = ? WHERE `uuid` = ? ;";
                conP.execute(sql, [req.body.tx, req.body.uuid]).then(() => {
                    logger.debug(`Completed ${reqInfo}`)
                    res.sendStatus(200);
                }).catch(reject)
                return
            }
            logger.debug(`Bad request ${reqInfo}`)
            res.sendStatus(400);
            return
        }
        sql = "UPDATE `swaps` SET `idena_tx` = ? WHERE `uuid` = ?;";
        conP.query(sql, [req.body.tx, req.body.uuid]).then(() => {
            logger.debug(`Completed ${reqInfo}`)
            res.sendStatus(200);
        }).catch(reject)
        return
    }
    if (data[0] && data[0].type === 1 && !(data[0].bsc_tx) && ethers.utils.isHexString(req.body.tx) && req.body.tx.length === 66) {
        if (await bsc.isTxExist(req.body.tx)) {
            if (await bsc.isValidBurnTx(req.body.tx, data[0].address, data[0].amount, data[0].time) && await bsc.isNewTx(req.body.tx)) {
                sql = "UPDATE `swaps` SET `bsc_tx` = ? WHERE `uuid` = ?;";
                conP.query(sql, [req.body.tx, req.body.uuid]).then(() => {
                    logger.debug(`Completed ${reqInfo}`)
                    res.sendStatus(200);
                }).catch(reject)
                return
            }
            logger.debug(`Bad request ${reqInfo}`)
            res.sendStatus(400);
            return
        }
        sql = "UPDATE `swaps` SET `bsc_tx` = ? WHERE `uuid` = ?;";
        conP.query(sql, [req.body.tx, req.body.uuid]).then(() => {
            logger.debug(`Completed ${reqInfo}`)
            res.sendStatus(200);
        }).catch(reject)
        return
    }
    logger.debug(`Bad request ${reqInfo}`)
    res.sendStatus(400);
}

router.post('/create', async function (req, res) {
    try {
        await create(req, res)
    } catch (error) {
        logger.error(`Failed ${req.path} (type=${req.body.type}, amount=${req.body.amount}, address=${req.body.address}): ${error}`)
        res.sendStatus(500)
    }
});

async function create(req, res) {
    const reqInfo = `${req.path} (type=${req.body.type}, amount=${req.body.amount}, address=${req.body.address})`
    logger.debug(`Got ${reqInfo}`)
    let type = parseInt(req.body.type);
    let amount = parseFloat(req.body.amount);
    if (!utils.isAddress(req.body.address) || (type !== 0 && type !== 1) || !(amount >= process.env.MIN_SWAP)) {
        logger.debug(`Bad request ${reqInfo}`)
        res.sendStatus(400);
        return
    }
    let newUUID = uuid.v4();
    let sql = "INSERT INTO `swaps`(`uuid`,`amount`,`address`,`type`) VALUES (?,?,?,?)";
    let values = [
        newUUID,
        amount.toFixed(8),
        req.body.address,
        type
    ];
    db.execute(sql, values, function (err, data, fields) {
        if (err) {
            logger.error(`Failed to handle request '/create': ${err}`)
            res.sendStatus(500)
            return
        }
        logger.debug(`Completed ${reqInfo}: ${newUUID}`)
        res.status(200).json({
            result: {
                "uuid": newUUID
            }
        })
    })
}

module.exports = router;