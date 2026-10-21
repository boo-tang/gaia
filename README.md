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

`LOCAL_DEPLOYMENT_ID` (default `local`) changes the names of the deployment files (`deployments/<id>.json`, `deployments/<id>.parameters.json`, `ignition/deployments/<id>`), for `deploy:local` and `seed:local`. The server test uses it for its own Anvil node.

## Server

`packages/server` indexes the auction events and serves the data for the map: an HTTP API and a live stream (SSE). The browser reads only this server for display. It writes through the wallet.

Run it against the local node, after `npm run chain:local`, `npm run deploy:local` and (optional) `npm run seed:local`:

```
npm start -w @gaia/server
```

The server keeps all data in memory. At each start it reads all events again from the deploy block (backfill), then it polls the chain about every 2 s. Configuration (environment variables, all optional for the local node):

| Variable | Default | Use |
| --- | --- | --- |
| `RPC_URLS` | `http://127.0.0.1:8545` | RPC URLs, separated by commas. The first is the main provider; the others are fallbacks. |
| `DEPLOYMENT_FILE` | `deployments/local.json` | The deployment file (a relative path starts at the repository root). |
| `PORT` | `8787` | The HTTP port. |
| `REORG_DEPTH` | `64` | The number of blocks that a reorg can undo. A deeper reorg clears the data and starts a new backfill. |
| `POLL_INTERVAL_MS` | `2000` | The time between two polls. |
| `LOG_RANGE` | `2000` | The largest block range of one `eth_getLogs` request. |
| `MAX_SNAPSHOT_BIDS` | `50000` | A snapshot with more bids gets HTTP 400 ("zoom in"). |

Endpoints (types in `packages/core/src/api.ts`; amounts in wei as decimal strings, squares packed as `(lat << 16) \| lng`):

- `GET /auction`: the auction rules, the status (`endTime`, paused, cancelled) and the position.
- `GET /bids?south=&north=&west=&east=`: the bids in a viewport (rows and columns of the grid, edges included; `west > east` crosses the antimeridian), with the position of the data.
- `GET /bidder/:address`: the shapes of a bidder (with the squares they still hold), their history, and the refund that `withdraw` sends now (read from the contract).
- `GET /stream?after=<block>:<logIndex>&bidder=`: the live stream. One message per event, with the id `<block>:<logIndex>`. Get a snapshot, then open the stream with `after` = the position of the snapshot. The browser resumes with `Last-Event-ID` after a reconnect. A `reorg` message means: get a new snapshot.
- `GET /health`: the position and the last block.

Tests: `npm test -w @gaia/server`. The test against Anvil starts its own node on a free port, so it can run next to `npm run chain:local`. It needs `anvil` and the contract build (`npx hardhat compile`); without `anvil` it is skipped.

## Web app

The web app (`packages/web`) is not written yet. The server is in `packages/server` (see Server) and the shared code in `packages/core`. Run `npm run typecheck` and `npm run test:packages` for all workspace packages.
