import { defineConfig, overrideTask } from "hardhat/config";
import hardhatIgnitionViem from "@nomicfoundation/hardhat-ignition-viem";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import fs from "fs-extra";
import path from "node:path";

// Copies the artifacts to the frontend after every build (`compile` is an alias of `build`).
const copyArtifactsToFrontend = overrideTask("build")
  .setInlineAction(async (taskArgs, hre, runSuper) => {
    const result = await runSuper(taskArgs);
    const frontendArtifacts = path.join(hre.config.paths.root, "frontend", "artifacts");
    fs.removeSync(frontendArtifacts);
    fs.copySync(hre.config.paths.artifacts, frontendArtifacts);
    console.log("Artifacts copied to frontend directory");
    return result;
  })
  .build();

export default defineConfig({
  plugins: [
    hardhatViem,
    hardhatMocha,
    hardhatNetworkHelpers,
    hardhatIgnitionViem,
    hardhatVerify,
  ],
  tasks: [copyArtifactsToFrontend],
  solidity: {
    version: "0.8.24",
    // Compiles the reference ERC-6551 registry so tests can deploy it.
    npmFilesToBuild: ["erc6551/ERC6551Registry.sol"],
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  // 1337 is the chain ID of wagmi's `localhost` chain, which the frontend uses. `default` runs
  // tests and scripts in-process; `node` is the chain `hardhat node` serves.
  networks: {
    default: {
      type: "edr-simulated",
      chainId: 1337,
    },
    node: {
      type: "edr-simulated",
      chainId: 1337,
    },
  },
});
