import { defineConfig } from "hardhat/config";
import hardhatIgnitionViem from "@nomicfoundation/hardhat-ignition-viem";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import hardhatViem from "@nomicfoundation/hardhat-viem";

export default defineConfig({
  plugins: [
    hardhatViem,
    hardhatMocha,
    hardhatNetworkHelpers,
    hardhatIgnitionViem,
    hardhatVerify,
  ],
  // The deployable contracts have the exact pragma 0.8.37. Base runs the osaka rules since its Azul
  // upgrade (May 2026). Change the version, the pragmas and the EVM version only together.
  solidity: {
    version: "0.8.37",
    // Compiles the reference ERC-6551 registry so tests can deploy it.
    npmFilesToBuild: ["erc6551/ERC6551Registry.sol"],
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "osaka",
    },
  },
  // `default` runs tests and scripts in-process. `node` is the chain `hardhat node` serves.
  // `anvil` is a local Anvil node (`yarn chain:local`), which `yarn deploy:local` deploys to.
  networks: {
    default: {
      type: "edr-simulated",
      chainId: 1337,
    },
    node: {
      type: "edr-simulated",
      chainId: 1337,
    },
    anvil: {
      type: "http",
      // LOCAL_RPC_URL overrides the URL, for example when another program uses port 8545.
      url: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
      chainId: 31337,
      // The public test mnemonic of Anvil and Hardhat. Use these accounts only on a local node.
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
      },
    },
  },
});
