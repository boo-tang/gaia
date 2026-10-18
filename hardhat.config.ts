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
  solidity: {
    version: "0.8.24",
    // Compiles the reference ERC-6551 registry so tests can deploy it.
    npmFilesToBuild: ["erc6551/ERC6551Registry.sol"],
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  // `default` runs tests and scripts in-process. `node` is the chain `hardhat node` serves.
  // `anvil` is a local Anvil node (`npm run chain:local`), which `npm run deploy:local` deploys to.
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
