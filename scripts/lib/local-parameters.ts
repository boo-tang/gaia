import type { DeploymentParameters } from "@nomicfoundation/ignition-core";
import fs from "node:fs";
import path from "node:path";

/// The committed parameters of the local deployment. It has all values except the auction times,
/// which come from the chain clock at deploy time (withAuctionTimes).
export const LOCAL_PARAMETERS_FILE = path.join("ignition", "parameters", "local.json");

/// The auction times of a deployment, in seconds (Unix time of the chain).
export type AuctionTimes = { startTime: bigint; endTime: bigint; maxEndTime: bigint };

/// Reads an Ignition parameters file. As in `hardhat ignition deploy --parameters`, a string of
/// digits that ends in "n" is a bigint ("900n" is 900n).
export function readParameters(file = LOCAL_PARAMETERS_FILE): DeploymentParameters {
  return JSON.parse(fs.readFileSync(file, "utf8"), (_key, value) => {
    if (typeof value === "string" && /^\d+n$/.test(value)) return BigInt(value.slice(0, -1));
    return value;
  });
}

/// Writes parameters in the format of readParameters (bigint as "900n").
export function writeParameters(file: string, parameters: DeploymentParameters) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(parameters, bigintReplacer, 2)}\n`);
}

/// For JSON.stringify: writes a bigint as "900n".
export function bigintReplacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return `${value}n`;
  return value;
}

/// The auction times for a chain clock of `now`. Defaults: the auction starts at `now`, ends
/// AUCTION_MINUTES (60) minutes later, and the soft close can move the end by up to 24 h. The
/// environment variables AUCTION_START_TIME, AUCTION_END_TIME and AUCTION_MAX_END_TIME (Unix
/// seconds) override each value.
export function auctionTimes(now: bigint, env: NodeJS.ProcessEnv = process.env): AuctionTimes {
  const minutes = BigInt(env.AUCTION_MINUTES ?? "60");
  const startTime = envTime(env.AUCTION_START_TIME) ?? now;
  const endTime = envTime(env.AUCTION_END_TIME) ?? startTime + minutes * 60n;
  const maxEndTime = envTime(env.AUCTION_MAX_END_TIME) ?? endTime + 24n * 3600n;
  return { startTime, endTime, maxEndTime };
}

function envTime(value: string | undefined): bigint | undefined {
  if (value === undefined || value === "") return undefined;
  return BigInt(value);
}

/// `parameters` with the auction times added to GaiaModule.
export function withAuctionTimes(
  parameters: DeploymentParameters,
  times: AuctionTimes
): DeploymentParameters {
  return { ...parameters, GaiaModule: { ...parameters.GaiaModule, ...times } };
}
