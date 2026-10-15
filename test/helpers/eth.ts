import { type Abi, type Hex, getAddress } from "viem";

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

type Target = { address: `0x${string}`; abi: Abi };
type MockWallet = Awaited<ReturnType<typeof viem.deployContract<"MockWallet">>>;

/// The ABI of `wallet` with the errors of `target`, so that viem names the errors that `exec`
/// passes on from `target`.
const execAbi = (wallet: MockWallet, target: Target) => [
  ...wallet.abi,
  ...target.abi.filter((item) => item.type === "error"),
];

/// Makes `wallet` (a MockWallet) call `target` with `data` and `value`. The default wallet client
/// sends the transaction and pays `value`.
export async function walletExec(
  wallet: MockWallet,
  target: Target,
  data: Hex,
  value = 0n,
  v = viem
) {
  const [sender] = await v.getWalletClients();
  return sender.writeContract({
    address: wallet.address,
    abi: execAbi(wallet, target),
    functionName: "exec",
    args: [target.address, value, data],
    value,
  });
}

/// The return data of `walletExec` with the same values, from a simulation. Sends nothing.
export async function walletExecResult(
  wallet: MockWallet,
  target: Target,
  data: Hex,
  value = 0n,
  v = viem
) {
  const [sender] = await v.getWalletClients();
  const publicClient = await v.getPublicClient();
  const { result } = await publicClient.simulateContract({
    account: sender.account,
    address: wallet.address,
    abi: execAbi(wallet, target),
    functionName: "exec",
    args: [target.address, value, data],
    value,
  });
  return result as Hex;
}
