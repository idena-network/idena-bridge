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

router.get('/latest', function (req, res) {
    let sql = "SELECT `address`,`type`,`amount`,`status`,`time` FROM `swaps` ORDER BY time DESC LIMIT 50;";
    db.query(sql, function (err, result, fields) {
        if (err) {
            console.error(`Failed to handle request '/latest': ${err}`)
            res.sendStatus(500)
            return
        }
        res.status(200).json({
            result: result
        })
    })
});

router.get('/info/:uuid', async function (req, res) {
    if (!uuid.validate(req.params.uuid)) {
        res.sendStatus(400);
        return
    }
    let sql = "SELECT * FROM `swaps` WHERE `uuid` = ? LIMIT 1;";
    db.promise().execute(sql, [req.params.uuid])
        .then(([data, fields]) => {
            if (!data[0]) {
                res.sendStatus(404);
                return
            }
            res.status(200).json({
                result: data[0]
            })
        })
        .catch(err => {
            console.error(`Failed to handle request '/info/${req.params.uuid}': ${err}`)
            res.sendStatus(500);
        });
});

router.post('/assign', async function (req, res) {
    if (!uuid.validate(req.body.uuid)) {
        res.sendStatus(400);
        return
    }
    function reject(err) {
        const errorMessagePrefix = `Failed to handle request '/assign', uuid=${req.body.uuid}:`
        console.error(`${errorMessagePrefix} ${err}`)
        res.sendStatus(500);
    }
    let conP = db.promise();
    let sql = "SELECT `uuid`,`amount`,`address`,`type`,`idena_tx`,`bsc_tx` FROM `swaps` WHERE `uuid` = ? LIMIT 1;";
    let data
    try {
        [data] = await conP.execute(sql, [req.body.uuid]);
    } catch (err) {
        reject(err)
        return
    }

    if (data[0] && data[0].type === 0 && !(data[0].idena_tx) && ethers.utils.isHexString(req.body.tx) && req.body.tx.length === 66) {
        if (await idena.isTxExist(req.body.tx)) {
            if (await idena.isValidSendTx(req.body.tx, data[0].address, data[0].amount) && await idena.isNewTx(req.body.tx)) {
                sql = "UPDATE `swaps` SET `idena_tx` = ? WHERE `uuid` = ? ;";
                conP.execute(sql, [req.body.tx, req.body.uuid]).then(() => {
                    res.sendStatus(200);
                }).catch(reject)
                return
            }
            res.sendStatus(400);
            return
        }
        sql = "UPDATE `swaps` SET `idena_tx` = ? WHERE `uuid` = ?;";
        conP.query(sql, [req.body.tx, req.body.uuid]).then(() => {
            res.sendStatus(200);
        }).catch(reject)
        return
    }
    if (data[0] && data[0].type === 1 && !(data[0].bsc_tx) && ethers.utils.isHexString(req.body.tx) && req.body.tx.length === 66) {
        if (await bsc.isTxExist(req.body.tx)) {
            if (await bsc.isValidBurnTx(req.body.tx, data[0].address, data[0].amount) && await bsc.isNewTx(req.body.tx)) {
                sql = "UPDATE `swaps` SET `bsc_tx` = ? WHERE `uuid` = ?;";
                conP.query(sql, [req.body.tx, req.body.uuid]).then(() => {
                    res.sendStatus(200);
                }).catch(reject)
                return
            }
            res.sendStatus(400);
            return
        }
        sql = "UPDATE `swaps` SET `bsc_tx` = ? WHERE `uuid` = ?;";
        conP.query(sql, [req.body.tx, req.body.uuid]).then(() => {
            res.sendStatus(200);
        }).catch(reject)
        return
    }
    res.sendStatus(400);
});

router.post('/create', function (req, res) {
    let type = parseInt(req.body.type);
    let amount = parseFloat(req.body.amount);
    if (!utils.isAddress(req.body.address) || (type !== 0 && type !== 1) || !(amount >= process.env.MIN_SWAP)) {
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
            console.error(`Failed to handle request '/create': ${err}`)
            res.sendStatus(500)
            return
        }
        res.status(200).json({
            result: {
                "uuid": newUUID
            }
        })
    })
});

module.exports = router;