# Gaia

PoC for an NFT project that will tokenize the world map.

Currently works by connecting your wallet, selecting a valid shape and "purchasing"

A valid shape is convex along rows and columns: each row and each column of the shape is one unbroken run of squares. Cross and plus shapes are valid. A shape can cross the 180° meridian. A square's coordinates are its south-west corner, in 1/100 degree: `lat` 0 to 17999 (90°S to 90°N), `lng` 0 to 35999 (180°W eastwards). All squares have the same price, but a square near a pole is smaller on the ground.

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
