const express = require('express'),
    app = express(),
    mysql = require('mysql2'),
    cors = require('cors'),
    bodyParser = require('body-parser'),
    idena = require('./idena'),
    bsc = require('./bsc');

db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});


async function checkSwaps() {
    let conP = db.promise();
    let sql = "SELECT * FROM `swaps` WHERE `status` = 'Pending';";
    const [data] = await conP.execute(sql);
    data.forEach(async swap => {
        if (swap.type == 0 && swap.idena_tx) {
            if (await idena.isTxExist(swap.idena_tx)) {
                if (await idena.isValidSendTx(swap.idena_tx, swap.address, swap.amount) && await idena.isNewTx(swap.idena_tx)) {
                    if (await idena.isTxConfirmed(swap.idena_tx)) {
                        // confirmed
                        const [data2] = await conP.execute("INSERT INTO `used_txs`(`blockchain`,`tx_hash`) VALUES ('idena',?);", [swap.idena_tx]);
                        if (data2.insertId) {
                            let {
                                hash,
                                fees
                            } = await bsc.mint(swap.address, swap.amount);
                            if (hash) {

                                conP.execute("UPDATE `swaps` SET `status` = 'Success' ,`mined` = '1' ,`bsc_tx` = ? ,`fees` = ? WHERE `uuid` = ?", [hash, fees, swap.uuid])
                            } else {
                                conP.execute("UPDATE `swaps` SET `status` = 'Fail' ,`mined` = '1' ,`fail_reason` = 'Unkown' WHERE `uuid` = ?", [swap.uuid])
                            }
                        }
                    } else {
                        // waiting to be confirmed
                        conP.execute("UPDATE `swaps` SET `mined` = '0' WHERE `uuid` = ?", [swap.uuid])
                    }
                } else {
                    // not new or not valid
                    conP.execute("UPDATE `swaps` SET `status` = 'Fail' ,`fail_reason` = 'Not Valid' WHERE `uuid` = ?", [swap.uuid])
                }
            } else {
                let date = Date.parse(swap.time);
                date.setDate(date.getDate() + 1);
                if (date < Date.now()) {
                    conP.execute("UPDATE `swaps` SET `status` = 'Fail' ,`fail_reason` = 'Time' WHERE `uuid` = ?", [swap.uuid])
                }
            }
        } else if (swap.type == 1 && swap.bsc_tx) {
            if (await bsc.isValidBurnTx(swap.bsc_tx, swap.address, swap.amount) && await bsc.isNewTx(swap.bsc_tx)) {
                if (await bsc.isTxConfirmed(swap.bsc_tx)) {
                    // confirmed
                    let sendTx = await idena.send(swap.address, swap.amount);
                    if (sendTx) {
                        conP.execute("UPDATE `swaps` SET `status` = 'Success' ,`mined` = '1' ,`idena_tx` = ? WHERE `uuid` = ?", [sendTx, swap.uuid])
                    } else {
                        conP.execute("UPDATE `swaps` SET `status` = 'Fail' ,`mined` = '1' ,`fail_reason` = 'Unkown' WHERE `uuid` = ?", [swap.uuid])
                    }
                } else {
                    // waiting to be confirmed
                    conP.execute("UPDATE `swaps` SET `mined` = '0' WHERE `uuid` = ?", [swap.uuid])
                }
            } else {
                // not new or not valid
                conP.execute("UPDATE `swaps` SET `status` = 'Fail' , `mined` = '2' , `fail_reason` = 'Not Valid' WHERE `uuid` = ?", [swap.uuid])
            }
        } else {
            let date = new Date(swap.time);
            date.setDate(date.getDate() + 1);
            if (date < Date.now()) {
                conP.execute("UPDATE `swaps` SET `status` = 'Fail' , `mined` = '2' ,`fail_reason` = 'Time' WHERE `uuid` = ?", [swap.uuid])
            }
        }
    });

}
checkSwaps();
const swaps = require('./routes/swaps');
app.use(cors())
app.use(bodyParser.json());
app.use('/swaps', swaps);


var port = 8000;
app.listen(port, () => console.log(`Server started, listening on port: ${port}`));