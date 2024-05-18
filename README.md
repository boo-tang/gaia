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

```
npx hardhat ignition deploy ignition/modules/GaiaLocation.ts --network localhost
```

Start web app

```
yarn dev
```

Then navigate to the localhost page exported by vite!
