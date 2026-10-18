import { type Abi, type Hex, decodeErrorResult } from "viem";

const UNRECOGNIZED = /unrecognized custom error \(return data: (0x[0-9a-fA-F]*)\)/;

/// The message of the error `e`. Hardhat names the custom error in the message only when it can
/// trace the revert. It cannot after the `nonReentrant` code of OpenZeppelin 5.5 and later, so the
/// message says "unrecognized custom error" and gives only the return data. Then this function
/// decodes the return data with `abi` and adds the name, for example `AuctionNotYetEnded()`.
export function revertMessage(e: unknown, abi: Abi): string {
  const message = e instanceof Error ? e.message : String(e);
  const data = UNRECOGNIZED.exec(message)?.[1];
  if (data === undefined) return message;
  try {
    const { errorName } = decodeErrorResult({ abi, data: data as Hex });
    return `${message}\ncustom error '${errorName}()'`;
  } catch {
    return message;
  }
}

/// Fails unless `call` reverts with the custom error `name` of `abi`.
export async function expectRevert(call: Promise<unknown>, abi: Abi, name: string) {
  let message: string | undefined;
  try {
    await call;
  } catch (e) {
    message = revertMessage(e, abi);
  }
  if (message === undefined) throw new Error(`expected the revert ${name}, the call succeeded`);
  if (!new RegExp(`\\b${name}\\(`).test(message)) {
    throw new Error(`expected the revert ${name}, got: ${message}`);
  }
}
