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
        if (err) throw err;
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
    let conP = db.promise();
    let sql = "SELECT * FROM `swaps` WHERE `uuid` = ? LIMIT 1;";
    const [data] = await conP.execute(sql, [req.params.uuid]);
    if (data[0]) {
        res.status(200).json({
            result: data[0]
        })
    } else {
        res.sendStatus(500);
    }
});

router.post('/assign', async function (req, res) {
    if (!uuid.validate(req.body.uuid)) {
        res.sendStatus(400);
        return
    }
    let conP = db.promise();
    let sql = "SELECT `uuid`,`amount`,`address`,`type`,`idena_tx`,`bsc_tx` FROM `swaps` WHERE `uuid` = ? LIMIT 1;";
    const [data] = await conP.execute(sql, [req.body.uuid]);

    if (data[0] && data[0].type == 0 && !(data[0].idena_tx) && ethers.utils.isHexString(req.body.tx) && req.body.tx.length == 66) {
        if (await idena.isTxExist(req.body.tx)) {
            if (await idena.isValidSendTx(req.body.tx, data[0].address, data[0].amount) && await idena.isNewTx(req.body.tx)) {
                sql = "UPDATE `swaps` SET `idena_tx` = ? WHERE `uuid` = ? ;";
                conP.execute(sql, [req.body.tx, req.body.uuid]).then(() => {
                    res.sendStatus(200);
                }).catch((err) => {
                    console.log(err);
                    res.sendStatus(500);
                })
            } else {
                res.sendStatus(400);
            }
        } else {
            sql = "UPDATE `swaps` SET `idena_tx` = ? WHERE `uuid` = ?;";
            conP.query(sql, [req.body.tx, req.body.uuid]).then(() => {
                res.sendStatus(200);
            }).catch((err) => {
                res.sendStatus(500);
            })
        }
    } else if (data[0] && data[0].type == 1 && !(data[0].bsc_tx) && ethers.utils.isHexString(req.body.tx) && req.body.tx.length == 66) {
        if (await bsc.isTxExist(req.body.tx)) {
            if (await bsc.isValidBurnTx(req.body.tx, data[0].address, data[0].amount) && await bsc.isNewTx(req.body.tx)) {
                sql = "UPDATE `swaps` SET `bsc_tx` = ? WHERE `uuid` = ?;";
                conP.query(sql, [req.body.tx, req.body.uuid]).then(() => {
                    res.sendStatus(200);
                }).catch((err) => {
                    res.sendStatus(500);
                })
            } else {
                res.sendStatus(400);
            }
        } else {
            sql = "UPDATE `swaps` SET `bsc_tx` = ? WHERE `uuid` = ?;";
            conP.query(sql, [req.body.tx, req.body.uuid]).then(() => {
                res.sendStatus(200);
            }).catch((err) => {
                res.sendStatus(500);
            })
        }
    } else {
        res.sendStatus(400);
    }


});

router.post('/create', function (req, res) {
    let type = parseInt(req.body.type);
    let amount = Math.floor(parseFloat(req.body.amount) * 100) / 100;
    if (!utils.isAddress(req.body.address) || ((type !== 0 && type !== 1)) || !(amount >= process.env.MIN_SWAP)) {
        res.sendStatus(400);
        return
    }
    let newUUID = uuid.v4();
    let sql = "INSERT INTO `swaps`(`uuid`,`amount`,`address`,`type`) VALUES (?,?,?,?)";
    let values = [
        newUUID,
        amount,
        req.body.address,
        type
    ];
    db.execute(sql, values, function (err, data, fields) {
        if (err) throw err;
        res.status(200).json({
            result: {
                "uuid": newUUID
            }
        })

    })
});

module.exports = router;