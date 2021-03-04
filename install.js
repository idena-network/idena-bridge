const fs = require("fs"),
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

createDb()