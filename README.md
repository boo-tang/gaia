# Gaia

PoC for an NFT project that will tokenize the world map.

Currently works by connecting your wallet, selecting a valid shape and "purchasing"

A valid shape is convex along rows and columns: each row and each column of the shape is one unbroken run of squares. Cross and plus shapes are valid. A shape can cross the 180° meridian. A square's coordinates are its south-west corner, in 1/100 degree: `lat` 0 to 17999 (90°S to 90°N), `lng` 0 to 35999 (180°W eastwards). All squares have the same price, but a square near a pole is smaller on the ground.

## Install Locally

Use Node 22.23.4 or later (see `.nvmrc`). The repository is an npm workspace. Install all packages from the root:

```
npm install
```

Compile Solidity contracts

```
npx hardhat compile
```

## Deploy

### Local node (Anvil)

Install [Foundry](https://book.getfoundry.sh/getting-started/installation) for `anvil`. Start the node in one terminal (chain ID 31337, port 8545):

```
npm run chain:local
```

Deploy all contracts in a second terminal:

```
npm run deploy:local
```

The script puts the ERC-6551 registry at its canonical address (`0x000000006551c19487814612e58FE06813775758`, the same as on Base), deploys `ignition/modules/GaiaSystem.ts` with `ignition/parameters/local.json`, and grants `ISSUER_ROLE` to the land sale from the admin account. It writes the addresses, the deploy block, the admin, the treasury and the auction times to `deployments/local.json` (not in git).

- The admin is Anvil account 1 and the treasury is Anvil account 2. The deployer (account 0) keeps no role.
- The auction starts at the chain clock and ends after 60 minutes. `maxEndTime` is 24 h after the end. `AUCTION_MINUTES` changes the length. `AUCTION_START_TIME`, `AUCTION_END_TIME` and `AUCTION_MAX_END_TIME` (Unix seconds) set each time.
- If port 8545 is in use, start `anvil --port 8546` and set `LOCAL_RPC_URL=http://127.0.0.1:8546` for each command.
- A second run on the same node changes nothing. After a restart of Anvil, the script deploys again.

Optional data for app work: `npm run seed:local` places three bids. `SEED_END=1 npm run seed:local` also moves the chain clock past the end of the auction and settles one shape. After that, the auction is closed; restart Anvil and deploy again for a new auction.

### Modules

`ignition/modules/Gaia.ts` deploys the country account implementation, `GaiaCountries`, `GaiaSquares` and `GaiaAuction`, makes the auction the only issuer, and moves the admin role from the deployer to `admin`. `GaiaLandSale.ts` deploys the sale of leftover squares, and `GaiaCountryMarket.ts` deploys the country market. `GaiaSystem.ts` deploys all of them. The parameters file has one section for each module (see `ignition/parameters/local.json`), with bigint values as strings that end in `n`. `GaiaModule` also needs `startTime`, `endTime` and `maxEndTime`. An ERC-6551 registry must be at `registry`.

On Base, the admin multisig grants `ISSUER_ROLE` to the land sale only after the auction ends. The Base networks and the Base parameters are not ready yet.

## Web app

The web app (`apps/web`) and the server (`apps/server`) are not written yet. Shared code is in `packages/core`. Run `npm run typecheck` and `npm run test:packages` for all workspace packages.
