import { HardhatUserConfig, task } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import * as fs from "fs-extra";
import * as path from "path";

// Extend the existing 'compile' task
task("compile", async (taskArgs, hre, runSuper) => {
  const result = await runSuper(taskArgs); // Run the original compile task first
  const artifactsDir = path.join(__dirname, "artifacts");
  const frontendDir = path.join(__dirname, "frontend");

  // Ensure the frontend directory exists
  if (!fs.existsSync(frontendDir)) {
    fs.mkdirSync(frontendDir, { recursive: true });
  }

  // Copy artifacts to the frontend directory
  fs.copySync(artifactsDir, path.join(frontendDir, "artifacts"));
  console.log("Artifacts copied to frontend directory");

  return result;
});

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    hardhat: {
      chainId: 1337,
    },
  },
};

export default config;
