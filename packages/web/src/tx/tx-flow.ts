// The state of one kind of transaction (the bid, the withdraw): one transaction at a time. The
// state is in a store, not in a component, so it stays when the panel mounts again.
import type { Hash, Log, TransactionReceipt } from 'viem';

import { type ErrorTexts, describeTxError } from './tx-errors';

export type TxState<R> =
  | { status: 'idle' }
  | { status: 'simulating' }
  /** The wallet asks the user to sign. `value` is the ETH of the transaction. */
  | { status: 'signing'; value: bigint }
  | { status: 'confirming'; hash: Hash; value: bigint }
  | { status: 'done'; hash: Hash; result: R }
  | { status: 'failed'; text: string; detail?: string };

export type TxStatus = TxState<unknown>['status'];

export interface TxFlow<R> {
  getState: () => TxState<R>;
  subscribe: (listener: () => void) => () => void;
  set: (state: TxState<R>) => void;
  /** True while a transaction is in progress (simulating, signing, confirming). */
  busy: () => boolean;
  /** Back to `idle`, except while a transaction is in progress. */
  reset: () => void;
}

const BUSY: TxStatus[] = ['simulating', 'signing', 'confirming'];

export const createTxFlow = <R>(): TxFlow<R> => {
  let state: TxState<R> = { status: 'idle' };
  const listeners = new Set<() => void>();
  const busy = () => BUSY.includes(state.status);
  const set = (next: TxState<R>) => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
    busy,
    reset: () => {
      if (!busy() && state.status !== 'idle') {
        set({ status: 'idle' });
      }
    },
  };
};

/** The part of a receipt that the flows read. */
export type TxReceipt = Pick<TransactionReceipt, 'status'> & { logs: Log[] };

/** The chain and wallet calls of one transaction. The app gives wagmi calls; tests give fakes. */
export interface TxSteps<R> {
  /** `simulateContract`. Not there: no simulation (the withdraw). */
  simulate?: () => Promise<unknown>;
  /** `writeContract`: the wallet asks the user to sign. Gives the transaction hash. */
  write: () => Promise<Hash>;
  waitForReceipt: (hash: Hash) => Promise<TxReceipt>;
  /** The result of a successful receipt, or a text when the receipt shows a failure. */
  read: (receipt: TxReceipt) => { result: R } | { text: string };
  /** ETH of the transaction. */
  value: bigint;
  /** The start of the error texts with no own entry, for example "The bid failed". */
  failed: string;
  texts: ErrorTexts;
  /** After a successful receipt. */
  onDone?: (result: R) => void;
}

/**
 * Runs one transaction: the simulation (a revert stops before the wallet opens), the wallet, the
 * receipt. A wallet rejection goes back to `idle`. A reverted receipt has no reason, so the flow
 * simulates the call again to find it. Does nothing while a transaction is in progress.
 */
export const runTx = async <R>(flow: TxFlow<R>, steps: TxSteps<R>): Promise<void> => {
  if (flow.busy()) {
    return;
  }
  const fail = (error: unknown) => {
    const described = describeTxError(error, steps.failed, steps.texts);
    flow.set(
      described.rejected ? { status: 'idle' } : { status: 'failed', text: described.text, detail: described.detail },
    );
  };

  let hash: Hash;
  try {
    if (steps.simulate !== undefined) {
      flow.set({ status: 'simulating' });
      await steps.simulate();
    }
    flow.set({ status: 'signing', value: steps.value });
    hash = await steps.write();
  } catch (error) {
    fail(error);
    return;
  }

  flow.set({ status: 'confirming', hash, value: steps.value });
  let receipt: TxReceipt;
  try {
    receipt = await steps.waitForReceipt(hash);
  } catch (error) {
    fail(error);
    return;
  }

  if (receipt.status === 'reverted') {
    try {
      await steps.simulate?.();
      flow.set({ status: 'failed', text: `${steps.failed} on the chain. Try again.` });
    } catch (error) {
      fail(error);
    }
    return;
  }
  const read = steps.read(receipt);
  if ('text' in read) {
    flow.set({ status: 'failed', text: read.text });
    return;
  }
  flow.set({ status: 'done', hash, result: read.result });
  steps.onDone?.(read.result);
};
