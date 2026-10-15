import { type Abi, type ContractEventName, type Hex, parseEventLogs } from "viem";

import { viem } from "./setup";

/// The arguments of each `eventName` event that the transaction `hash` emitted, decoded with
/// `abi`. `v` is the connection (default: the shared connection).
export async function eventsIn<const abi extends Abi, eventName extends ContractEventName<abi>>(
  hash: Hex,
  abi: abi,
  eventName: eventName,
  v = viem
) {
  const publicClient = await v.getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return parseEventLogs({ abi, eventName, logs: receipt.logs }).map((log) => log.args);
}
