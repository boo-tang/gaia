// The withdraw of the refund: the steps of the transaction (`runTx`). It has no simulation:
// `withdraw()` reverts only on a reentrant call. The wagmi calls come from useWithdraw.ts.
import { gaiaAuctionAbi } from '@gaia/core';

import { type Address, type Hash, isAddressEqual, parseEventLogs } from 'viem';

import { type TxReceipt, type TxSteps, createTxFlow } from '../tx/tx-flow';

/** The flow of the withdraw. The result is `amount` of the `Withdrawn` event. */
export const withdrawFlow = createTxFlow<bigint>();

/**
 * `withdraw()` does not revert when the ETH transfer fails: it returns false and emits no
 * `Withdrawn` event. It also emits none when the refund is 0.
 */
export const NOTHING_SENT = 'No ETH was sent. Your wallet may not accept ETH from a contract: use a different wallet.';

/** `amount` of the `Withdrawn` event of `bidder` in the receipt. */
export const withdrawnFromReceipt = (receipt: TxReceipt, bidder: Address): bigint | undefined =>
  parseEventLogs({ abi: gaiaAuctionAbi, eventName: 'Withdrawn', logs: receipt.logs }).find(event =>
    isAddressEqual(event.args.bidder, bidder),
  )?.args.amount;

export interface WithdrawCalls {
  write: () => Promise<Hash>;
  waitForReceipt: TxSteps<bigint>['waitForReceipt'];
}

export const withdrawSteps = (
  bidder: Address,
  calls: WithdrawCalls,
  onDone?: (amount: bigint) => void,
): TxSteps<bigint> => ({
  write: calls.write,
  waitForReceipt: calls.waitForReceipt,
  read: receipt => {
    const amount = withdrawnFromReceipt(receipt, bidder);
    return amount === undefined ? { text: NOTHING_SENT } : { result: amount };
  },
  value: 0n,
  failed: 'The withdraw failed',
  texts: {},
  onDone,
});
