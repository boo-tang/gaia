import { use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { network } from "hardhat";

use(chaiAsPromised);

// One connection shared by every test file, as `hre` was in Hardhat 2. Fixtures snapshot and
// revert this connection's chain, so tests stay isolated.
export const { viem, networkHelpers, provider } = await network.getOrCreate();
export const loadFixture = networkHelpers.loadFixture.bind(networkHelpers);
export const time = networkHelpers.time;
