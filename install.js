const {
    Transaction,
    privateKeyToAddress
} = require('./idena/script.js'),
    axios = require('axios'),
    fs = require("fs"),
    mysql = require('mysql2');
require('dotenv').config();


async function createDb() {
    const db = fs.readFileSync('./db.sql', "utf-8");
    var con = mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        multipleStatements: true
    }).promise();

    if (await con.connect()) {
        try {
            await con.query(db);
            console.log("the table has been created");

        } catch (error) {
            console.log(error);
            console.log("error while creating the table");

        }
    } else {
        console.log("error while trying to connect to the database");

    }
    con.destroy();

}


async function setNonce() {
    try {
        let apiResp = await axios.post(process.env.IDENA_PROVIDER, {
            "method": "dna_getBalance",
            "id": 1,
            "key": process.env.IDENA_API_KEY,
            "params": [privateKeyToAddress(process.env.IDENA_PRIVATE_KEY)]
        })

        fs.writeFileSync("./idena/nonce.json", JSON.stringify({
            nonce: apiResp.data.result.nonce
        }), "utf8")
        console.log("the idena local nonce has has been set");
    } catch (error) {
        console.log(error);
        console.log("error while trying to set the idena local nonce");
    }
}



setNonce()
createDb()