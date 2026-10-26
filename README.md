# Gaia

PoC for an NFT project that will tokenize the world map.

Currently works by connecting your wallet, selecting a valid shape and "purchasing"

A valid shape is convex along rows and columns: each row and each column of the shape is one unbroken run of squares. Cross and plus shapes are valid. A shape can cross the 180° meridian. A square's coordinates are its south-west corner, in 1/100 degree: `lat` 0 to 17999 (90°S to 90°N), `lng` 0 to 35999 (180°W eastwards). All squares have the same price, but a square near a pole is smaller on the ground.

## Install Locally

Use Node 22.23.4 or later (see `.nvmrc`). The repository is a Yarn workspace (Yarn 4, from `packageManager` in `package.json`). Enable Corepack once, then install all packages from the root:

```
corepack enable
yarn install
```

Compile Solidity contracts

```
yarn hardhat compile
```

## Deploy

### Local node (Anvil)

Install [Foundry](https://book.getfoundry.sh/getting-started/installation) for `anvil`. Start the node in one terminal (chain ID 31337, port 8545):

```
yarn chain:local
```

Deploy all contracts in a second terminal:

```
yarn deploy:local
```

The script puts the ERC-6551 registry at its canonical address (`0x000000006551c19487814612e58FE06813775758`, the same as on Base), deploys `ignition/modules/GaiaSystem.ts` with `ignition/parameters/local.json`, and grants `ISSUER_ROLE` to the land sale from the admin account. It writes the addresses, the deploy block, the admin, the treasury and the auction times to `deployments/local.json` (not in git).

- The admin is Anvil account 1 and the treasury is Anvil account 2. The deployer (account 0) keeps no role.
- The auction starts at the chain clock and ends after 60 minutes. `maxEndTime` is 24 h after the end. `AUCTION_MINUTES` changes the length. `AUCTION_START_TIME`, `AUCTION_END_TIME` and `AUCTION_MAX_END_TIME` (Unix seconds) set each time.
- If port 8545 is in use, start `anvil --port 8546` and set `LOCAL_RPC_URL=http://127.0.0.1:8546` for each command.
- A second run on the same node changes nothing. After a restart of Anvil, the script deploys again.

### Base Sepolia

Store the RPC URL and the key of a new testnet-only deployer in the Hardhat keystore (encrypted, outside the repository), and fund the deployer from a Base Sepolia faucet:

```
yarn hardhat keystore set BASE_SEPOLIA_RPC_URL
yarn hardhat keystore set BASE_SEPOLIA_DEPLOYER_KEY
```

Deploy with the admin, the treasury and the auction times (Unix seconds):

```
GAIA_ADMIN=0x… GAIA_TREASURY=0x… AUCTION_START_TIME=… AUCTION_END_TIME=… AUCTION_MAX_END_TIME=… yarn deploy:base-sepolia
```

The script checks the chain ID (84532) and that the canonical ERC-6551 registry has code, then deploys `GaiaSystem.ts` with `ignition/parameters/base-sepolia.json` and writes `deployments/base-sepolia.json`. The server and the web build need this file, so commit it with `git add -f`.

- `GAIA_ADMIN` must not be the deployer: the deployer gives up the admin role.
- The land sale does not get `ISSUER_ROLE`. The admin grants it after the auction ends.
- The first run saves its parameters in `deployments/base-sepolia.parameters.json`. A later run resumes the Ignition deployment with them (for example after a failed transaction) and ignores the environment values. For a new deployment, remove that file and `ignition/deployments/base-sepolia`.

### Seed data

Optional data for app work: `yarn seed:local` places three bids. `SEED_SQUARES=15000 yarn seed:local` places bids on about 15,000 squares for the map (rectangles of up to `maxShapeSquares` squares north of London, from Oxford to east of St Albans, across the antimeridian near Fiji and at 86°N); a second run with the same value outbids the north half of each rectangle. Seed before the auction ends. `SEED_END=1 yarn seed:local` also moves the chain clock past the end of the auction and settles one shape. After that, the auction is closed; restart Anvil and deploy again for a new auction.

### Modules

`ignition/modules/Gaia.ts` deploys the country account implementation, `GaiaCountries`, `GaiaSquares` and `GaiaAuction`, makes the auction the only issuer, and moves the admin role from the deployer to `admin`. `GaiaLandSale.ts` deploys the sale of leftover squares, and `GaiaCountryMarket.ts` deploys the country market. `GaiaSystem.ts` deploys all of them. The parameters file has one section for each module (see `ignition/parameters/local.json`), with bigint values as strings that end in `n`. `GaiaModule` also needs `startTime`, `endTime` and `maxEndTime`. An ERC-6551 registry must be at `registry`.

On Base, the admin grants `ISSUER_ROLE` to the land sale only after the auction ends.

`LOCAL_DEPLOYMENT_ID` (default `local`) changes the names of the deployment files (`deployments/<id>.json`, `deployments/<id>.parameters.json`, `ignition/deployments/<id>`), for `deploy:local` and `seed:local`. The server test uses it for its own Anvil node.

## Server

`packages/server` indexes the auction events and serves the data for the map: an HTTP API and a live stream (SSE). The browser reads only this server for display, except the user's own bid, which the map shows from its transaction receipt. It writes through the wallet.

Run it against the local node, after `yarn chain:local`, `yarn deploy:local` and (optional) `yarn seed:local`:

```
yarn workspace @gaia/server start
```

The server keeps all data in memory. At each start it reads all events again from the deploy block (backfill), then it polls the chain about every 2 s. Configuration (environment variables, all optional for the local node):

| Variable | Default | Use |
| --- | --- | --- |
| `RPC_URLS` | `http://127.0.0.1:8545` | RPC URLs, separated by commas. The first is the main provider; the others are fallbacks. |
| `DEPLOYMENT_FILE` | `deployments/local.json` | The deployment file (a relative path starts at the repository root). |
| `HOST` | `127.0.0.1` | The address the server listens on. `0.0.0.0`: all interfaces. |
| `PORT` | `8787` | The HTTP port. |
| `WEB_DIR` | (empty) | The web build (`packages/web/dist`; a relative path starts at the repository root). When set, the server also serves the web app, and the endpoints below move under `/api`. |
| `REORG_DEPTH` | `64` | The number of blocks that a reorg can undo. A deeper reorg clears the data and starts a new backfill. |
| `POLL_INTERVAL_MS` | `2000` | The time between two polls. |
| `LOG_RANGE` | `2000` | The largest block range of one `eth_getLogs` request. |
| `MAX_SNAPSHOT_BIDS` | `50000` | A snapshot with more bids gets HTTP 400 ("zoom in"). |

Endpoints (types in `packages/core/src/api.ts`; amounts in wei as decimal strings, squares packed as `(lat << 16) \| lng`; shape and country IDs are numbers):

- `GET /auction`: the auction rules, the status (`endTime`, paused, cancelled) and the ID of the last event in the data.
- `GET /bids?south=&north=&west=&east=`: the bids in a viewport (rows and columns of the grid, edges included; `west > east` crosses the antimeridian), with the ID of the last event in the data.
- `GET /bidder/:address`: the shapes of a bidder (with the squares they still hold), their history, and the refund that `withdraw` sends now (read from the contract).
- `GET /stream?after=<block>:<logIndex>&bidder=`: the live stream. One message per event; the SSE id is the event ID, `<block>:<logIndex>`. Get a snapshot, then open the stream with `after` = `lastEventId` of the snapshot (with no `after`, the stream starts from the first message). The browser resumes with `Last-Event-ID` after a reconnect. A `reorg` message means: get a new snapshot.
- `GET /health`: the last event ID and the last applied block.

Tests: `yarn workspace @gaia/server test`. The test against Anvil starts its own node on a free port, so it can run next to `yarn chain:local`. It needs `anvil` and the contract build (`yarn hardhat compile`); without `anvil` it is skipped.

## Web app

`packages/web` is the web app: React, Vite, wagmi, RainbowKit and TanStack Query. It shows only the data of the server (see Server) and writes through the wallet. The shared code is in `packages/core`.

Run it against the local node, each command in its own terminal:

```
yarn chain:local
yarn deploy:local
yarn seed:local
yarn workspace @gaia/server start
yarn workspace @gaia/web dev
```

Then open http://localhost:5173. In development, Vite sends `/api/*` to the server (the server has no CORS). To connect on Anvil, use a browser wallet with an Anvil account key (see "Bid and withdraw"). Base Account does not work on Anvil.

Configuration: copy `packages/web/.env.example` to `packages/web/.env.local`. All variables are optional for the local node.

| Variable | Default | Use |
| --- | --- | --- |
| `DEPLOYMENT_FILE` | `deployments/local.json` | The deployment file (a relative path starts at the repository root). Its chain ID selects the chain of the app: 31337 (Anvil) or 84532 (Base Sepolia). A missing or wrong file stops `dev` and `build`. |
| `API_PROXY_TARGET` | `http://localhost:8787` | Development only: the server for `/api/*`. |
| `VITE_API_URL` | `/api` | The API base URL in the browser. A server with `WEB_DIR` serves the API at `/api` on the same origin. |
| `VITE_RPC_URL` | `http://127.0.0.1:8545` on Anvil | The RPC URL of the chain. Required for Base Sepolia. |
| `VITE_WALLETCONNECT_PROJECT_ID` | (empty) | The WalletConnect project ID. With no ID, the wallet list has only the browser wallet and Base Account. |
| `VITE_MAP_STYLE_URL` | `https://tiles.openfreemap.org/styles/positron` | A map style of the OpenMapTiles schema. The map takes its tiles and place names and uses its own colours. |

Base Sepolia build (the files are in `packages/web/dist`):

```
DEPLOYMENT_FILE=deployments/base-sepolia.json VITE_RPC_URL=https://sepolia.base.org yarn workspace @gaia/web build
```

Each `VITE_*` value is public in the build. `VITE_RPC_URL` is the public Base Sepolia RPC, never a URL with a key.

### Map

The map (`packages/web/src/map/`) is MapLibre GL on a globe, with `deck.gl` layers in the same canvas: the bids (one square for each bid, a colour for each bidder, an own colour for the connected wallet), the grid (from zoom 9), the selection and the square under the pointer. Place names stay above the bids. The map loads in its own chunk. The first view is the last view of the browser, else the region of the browser time zone, else the whole globe; "My location" asks for the browser location. The data comes from the server: a snapshot (`GET /bids`) after each move and one live stream (`GET /stream`) for the app (`packages/web/src/bids/`). The user's own bid shows as soon as its receipt arrives: the receipt holds the same `ShapeBid` event, with the same event ID, as the stream message that follows, so that message changes nothing.

See the map with live bids on Anvil:

1. `yarn chain:local`, then `yarn deploy:local` and `SEED_SQUARES=15000 yarn seed:local`.
2. `yarn workspace @gaia/server start` and `yarn workspace @gaia/web dev`, then open http://localhost:5173 (in a visible browser window: a hidden tab gets no animation frames and the map loads slowly).
3. The seed bids are north of London (from 51.7°N, 2°W to 2°E: Oxford, Luton, St Albans), near Fiji across the antimeridian (17.8°S, 180°), and at 86°N, 180°W. Zoom in: the grid fades in from zoom 9. The square under the pointer and its bid show at the bottom left.
4. Live bids: run `SEED_SQUARES=15000 yarn seed:local` again. The north halves change colour and price with no reload.
5. "Zoom in": start the server with `MAX_SNAPSHOT_BIDS=100`. A view with more bids shows "Zoom in to load the bids." and keeps the bids that the map has.
6. Stream failure: stop the server. After 5 s the map shows "Live updates failed. Please refresh the page." The app tries again; when the server is back, the message goes away.

### Shape selection

The map has a tool picker at the top left, as in an image editor: "Pointer" (key H) and "Rectangle" (key R). With both tools a drag pans the map. With the pointer, a click on a square selects it, and a click on a selected square removes it. With the rectangle, the first click starts a rectangle that follows the pointer, and the second click adds all squares inside it to the selection, also across the antimeridian; Escape drops it. A rectangle of one square works like a pointer click. "Clear" in the bid panel removes all selected squares. The app keeps at most 10,000 selected squares.

The price has two options: "Minimum bid" (each square gets its minimum next bid) or "Set price per square" (one price in ETH for each square, at least the highest minimum next bid of the selection). The squares of the connected wallet cost 0. The panel shows the total, the new, outbid and own squares, the shapes that the selection takes squares from, and the shape limits of the auction as information. The client does not check the shape rules: the simulation of the bid gives the contract error before the wallet opens. The map colours each selected square by its cost (own squares green), and the readout shows the price of the square under the pointer.

Try it on Anvil (after the steps of the map above):

1. Near Oxford, press R, click, move over seed bids and empty squares and click again. The panel shows the squares, the total and the shapes that the selection cuts into. Draw another rectangle: the squares are added. Press H and click a selected square: it is removed.
2. Choose "Set price per square", then "Use minimum". The total is the price times the number of squares.
3. Near Fiji, draw a rectangle across 180°: the selection has the columns on both sides.
4. Draw a very large rectangle at a low zoom: the map says "Too many squares" and the selection does not change.

### Bid and withdraw

"Bid" sends `bidOnShape` with exactly the total of the panel as the value. Just before the wallet opens, the app simulates the bid on the RPC node: a contract error (for example "The prices changed. The bid now costs X ETH.") shows below the button and the wallet does not open. A rejection in the wallet is not an error: the panel goes back to the selection. While the transaction waits, the button says so. After the receipt the panel shows "Bid placed: X ETH" (with a link to the block explorer; Anvil has none), the map shows the bid, and the selection clears. A bid that fails keeps the selection. Bid is disabled before the start, while the auction is paused, after a cancel and after the end time, with no wallet, and with a wallet on a different chain.

"Your bids" (also on a phone) shows the refund of the wallet: the outbid amounts and, after a cancel, all bids (`refund` of `GET /bidder/:address`). It loads again after each bid and withdraw, and when the live stream sends a bid that takes squares of the wallet. Until the server has the user's last bid, it says "Bid confirmed. Updating your bids…". "Withdraw" sends the refund to the wallet.

Wallet setup on Anvil: in a browser wallet (for example MetaMask or Rabby), add the network RPC URL `http://127.0.0.1:8545`, chain ID 31337, currency ETH. Import the private key of an Anvil account (`anvil` prints the keys at the start). Accounts 3 to 9 place the seed bids; account 1 is the admin. Use a different account in a second browser profile to bid against the first. After a restart of Anvil, reset the account in the wallet (the nonce starts at 0 again).

Try it on Anvil (after `yarn chain:local`, `yarn deploy:local`, `yarn seed:local`, the server and the web app):

1. Connect with account 6. Select squares over a seed bid near London and click "Bid". The panel shows "Bid placed: X ETH" and the map shows the squares in the colour of the wallet.
2. Select squares again and wait for the total. In a second profile with account 7, bid on one of these squares. The first panel shows the new total within a few seconds. To see the simulation stop a bid with an old total, stop the server before the second bid and click "Bid" in the first panel: it shows "The prices changed. The bid now costs X ETH."
3. In the second profile, "Your bids" shows the refund of account 7 after the bid of account 6. Click "Withdraw": the panel shows "Withdrawn: X ETH" and the refund goes to 0.
4. Pause and cancel as the admin (account 1, which Anvil unlocks):

```
cast send --unlocked --from 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 <GaiaAuction address> "pause()"
cast send --unlocked --from 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 <GaiaAuction address> "cancel()"
```

The status bar says "Auction paused", then "Auction cancelled", and Bid is disabled. After the cancel, "Your bids" says "The auction is cancelled. Withdraw your bids." and the refund holds all bids of the wallet. The address of `GaiaAuction` is in `deployments/local.json`.

5. End time: deploy with `AUCTION_MINUTES=3` on a new Anvil. At the end time the status bar says "Auction ended" and Bid is disabled within one second. A bid in the last 15 minutes (`extensionWindow`) moves the end time, and the status bar shows the new time within a few seconds.

`packages/server/test/anvil-integration.test.ts` checks that a bid with the total of the app (`priceSelection` of `packages/core` on the data of `GET /bids`) pays exactly that total (`paid` of `ShapeBid`), and that after a different bid on one of its squares, the simulation with the old total reverts with `InsufficientValue` and the new total of the app.

The map needs WebGL, so the unit tests do not render it (jsdom). `yarn workspace @gaia/web time-zones` makes `src/map/time-zones.ts` again from the IANA `zone.tab`.

Layout: on a screen narrower than 768 px, the app shows the view-only layout (map, bidder view, "Withdraw") with no bid panel.

Scripts: `dev`, `build`, `preview`, `typecheck`, `test` and `time-zones` (`yarn workspace @gaia/web <script>`). The tests use `packages/web/test/fixtures/deployment.json`, not the local deployment.

Run `yarn lint`, `yarn typecheck` and `yarn test:packages` for all workspace packages. `yarn format` runs Prettier on the whole repository.
