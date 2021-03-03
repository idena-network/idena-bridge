const path = require('path')
const pino = require('pino')
const fs = require('fs');

const logDir = process.env.LOG_DIR
if (logDir && !fs.existsSync(logDir)){
    fs.mkdirSync(logDir, { recursive: true });
}

const logger = pino(
    {
        level: process.env.LOG_LEVEL || 'info',
        base: {pid: process.pid},
        timestamp: () => `,"time":"${new Date().toISOString()}"`,
    },
    path.join(logDir || '', 'idena-bridge.log')
)

module.exports = logger;