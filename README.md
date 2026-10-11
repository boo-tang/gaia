# Gaia

PoC for an NFT project that will tokenize the world map.

Currently works by connecting your wallet, selecting a valid (concave) shape and "purchasing"

## Install Locally

Install TypeScript packages

```
yarn install
```

Build Typescript project

```
yarn build
```

Compile Solidity contracts

```
npx hardhat compile
```

Start local Ethereum node

```
npx hardhat node
```

Deploy compiled contracts

`ignition/modules/Gaia.ts` deploys the country account implementation, `GaiaCountries`, `GaiaSquares` and `GaiaAuction`. It needs a parameters file (`admin`, `registry`, `treasury`, `startTime`, `endTime`, `maxEndTime`, `extensionWindow`, `minBidPerSquareWei`, `minBidIncrementBps`, `minShapeSquares`, `maxShapeSquares`, `maxShapeAspectRatio`) and an ERC-6551 registry at `registry`. A local deployment script is not ready yet.

```
npx hardhat ignition deploy ignition/modules/Gaia.ts --network localhost --parameters <parameters.json>
```

Start web app

```
yarn dev
```

Then navigate to the localhost page exported by vite!
