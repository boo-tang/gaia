import { type Hex, getAddress } from "viem";

import { viem } from "./setup";

/// The ETH balance change of `address` over the transaction that `send` sends, plus the gas cost
/// if `address` sent it. Thus a refund to the sender shows as its full amount. Also returns the
/// receipt. `v` is the connection (default: the shared connection).
export async function balanceChange(
  address: `0x${string}`,
  send: () => Promise<Hex>,
  v = viem
) {
  const publicClient = await v.getPublicClient();
  const before = await publicClient.getBalance({ address });
  const hash = await send();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const after = await publicClient.getBalance({ address });
  const gas =
    getAddress(receipt.from) === getAddress(address)
      ? receipt.gasUsed * receipt.effectiveGasPrice
      : 0n;
  return { change: after - before + gas, receipt };
}
