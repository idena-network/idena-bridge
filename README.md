# idenaBridge

### installation 
create .env file and fill these values
```
BSC_PRIVATE_KEY="" # The bridge wallet's privateKey in BSC blockchain
BSC_RPC="https://data-seed-prebsc-1-s1.binance.org:8545"  # the BSC RPC ( this one for testnet) -- for more rpc > https://docs.binance.org/smart-chain/developer/rpc.html
BSC_NETWORK=  # the BSC RPC
BSC_CONTRACT=""  # contract address
BSC_CONFIRMATIONS_BLOCKS=3 # confirmations required
BSC_FEES=150  # the fee percent of the real fees --  if BSC gonna charge 1 idna in USD then the bridge will substract 1.5 iDNA  before minting -- only applied for swaps type 0 
IDENA_PROVIDER="" # a private or public node can be used -- this field for the rpc url
IDENA_API_KEY=""  # the rpc key
IDENA_PRIVATE_KEY="" # The bridge wallet's privateKey in Idena blockchain
MIN_SWAP=10 # Min amount that can be swapped
IDENA_CONFIRMATIONS_BLOCKS=3 # confirmations required
IDENA_FIXED_FEES=1 # Fixed fees in iDNA ( this only gets applied for type 1 > from BSC to IDENA)
CHECKING_DELAY=5000 # the delay between each checking (a function checks if there is a pending Swaps ...)
# mysql db configuration
DB_HOST=""
DB_NAME=""
DB_PASS=""
DB_HOST=""
DB_USERNAME=""
```

Then execute ```node install.js```
This will create or edit the idena/nonce.json file and add the current nonce of idena wallet and will also recreate the db table

This can be skipped if u already setted the local nonce manually and also created the db table 

To start the bridge backend execute this ```npm start```
Notice : start only 1 instance and do not use pm2 ( because of the checker function)