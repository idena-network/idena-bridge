CREATE TABLE `swaps`
(
    `id`          int(11)     NOT NULL AUTO_INCREMENT,
    `address`     varchar(42)          DEFAULT NULL,
    `amount`      decimal(36, 18)      DEFAULT NULL,
    `fees`        decimal(36, 18)      DEFAULT NULL,
    `uuid`        varchar(36)          DEFAULT NULL,
    `time`        timestamp   NOT NULL DEFAULT current_timestamp(),
    `idena_tx`    varchar(66)          DEFAULT NULL,
    `bsc_tx`      varchar(66)          DEFAULT NULL,
    `status`      varchar(20) NOT NULL DEFAULT 'Pending',
    `type`        int(1)      NOT NULL DEFAULT 0,
    `mined`       int(1)               DEFAULT NULL,
    `fail_reason` varchar(255)         DEFAULT NULL,
    PRIMARY KEY (`id`)
);
ALTER TABLE `swaps`
    ADD UNIQUE INDEX `swaps_uuid_unique_idx` (`uuid`);
ALTER TABLE `swaps`
    ADD INDEX `swaps_time_idx` (`time`);
ALTER TABLE `swaps`
    ADD INDEX `swaps_status_idx` (`status`);

CREATE TABLE `used_txs`
(
    `id`         int(11)     NOT NULL AUTO_INCREMENT,
    `blockchain` varchar(5) DEFAULT NULL,
    `tx_hash`    varchar(66) NOT NULL,
    PRIMARY KEY (`id`)
);
ALTER TABLE `used_txs`
    ADD UNIQUE INDEX `used_txs_blockchain_tx_hash_unique_idx` (`tx_hash`, `blockchain`);