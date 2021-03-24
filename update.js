const fs = require("fs"),
    mysql = require('mysql2');
require('dotenv').config();

async function updateDb() {
    const db = fs.readFileSync('./db-update.sql', "utf-8");
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
            console.log("the database has been updated");

        } catch (error) {
            console.log(error);
            console.log("error while updating the database");

        }
    } else {
        console.log("error while trying to connect to the database");

    }
    con.destroy();
}

updateDb()