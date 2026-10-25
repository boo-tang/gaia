import type { Hash } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { type TxReceipt, type TxState, type TxSteps, createTxFlow, runTx } from '../src/tx/tx-flow';

const HASH: Hash = `0x${'ab'.repeat(32)}`;
const SUCCESS: TxReceipt = { status: 'success', logs: [] };

const steps = (change: Partial<TxSteps<string>> = {}): TxSteps<string> => ({
  simulate: vi.fn(() => Promise.resolve()),
  write: vi.fn(() => Promise.resolve(HASH)),
  waitForReceipt: vi.fn(() => Promise.resolve(SUCCESS)),
  read: () => ({ result: 'ok' }),
  value: 5n,
  failed: 'The test failed',
  texts: {},
  onDone: vi.fn(),
  ...change,
});

/** Runs the flow and keeps each state. */
const run = async (input: TxSteps<string>) => {
  const flow = createTxFlow<string>();
  const states: TxState<string>[] = [];
  flow.subscribe(() => states.push(flow.getState()));
  await runTx(flow, input);
  return { flow, states: states.map(state => state.status), last: flow.getState() };
};

describe('runTx', () => {
  it('simulates, asks the wallet, waits for the receipt', async () => {
    const input = steps();
    const { states, last } = await run(input);
    expect(states).toEqual(['simulating', 'signing', 'confirming', 'done']);
    expect(last).toEqual({ status: 'done', hash: HASH, result: 'ok' });
    expect(input.onDone).toHaveBeenCalledWith('ok');
  });

  it('does not open the wallet when the simulation reverts', async () => {
    const input = steps({ simulate: () => Promise.reject(new Error('reverted')) });
    const { states, last } = await run(input);
    expect(states).toEqual(['simulating', 'failed']);
    expect(last).toEqual({ status: 'failed', text: 'The test failed: reverted', detail: undefined });
    expect(input.write).not.toHaveBeenCalled();
  });

  it('goes back to idle when the user rejects the transaction', async () => {
    const rejection = Object.assign(new Error('User rejected'), { code: 4001 });
    const { states, last } = await run(steps({ write: () => Promise.reject(rejection) }));
    expect(states).toEqual(['simulating', 'signing', 'idle']);
    expect(last.status).toBe('idle');
  });

  it('simulates again after a reverted receipt to find the reason', async () => {
    const simulate = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('InsufficientValue'));
    const input = steps({ simulate, waitForReceipt: () => Promise.resolve({ status: 'reverted', logs: [] }) });
    const { last } = await run(input);
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(last).toMatchObject({ status: 'failed', text: 'The test failed: InsufficientValue' });
    expect(input.onDone).not.toHaveBeenCalled();
  });

  it('has a short text when a reverted receipt simulates well again', async () => {
    const { last } = await run(steps({ waitForReceipt: () => Promise.resolve({ status: 'reverted', logs: [] }) }));
    expect(last).toEqual({ status: 'failed', text: 'The test failed on the chain. Try again.' });
  });

  it('runs with no simulation, and fails when the receipt shows a failure', async () => {
    const { states, last } = await run(steps({ simulate: undefined, read: () => ({ text: 'No ETH was sent.' }) }));
    expect(states).toEqual(['signing', 'confirming', 'failed']);
    expect(last).toEqual({ status: 'failed', text: 'No ETH was sent.' });
  });

  it('runs one transaction at a time', async () => {
    const flow = createTxFlow<string>();
    let sign: (hash: Hash) => void = () => {};
    const first = steps({ write: () => new Promise<Hash>(resolve => (sign = resolve)) });
    const second = steps();
    const running = runTx(flow, first);
    await vi.waitFor(() => expect(flow.getState().status).toBe('signing'));
    expect(flow.busy()).toBe(true);
    await runTx(flow, second);
    expect(second.simulate).not.toHaveBeenCalled();
    flow.reset();
    expect(flow.getState().status).toBe('signing');
    sign(HASH);
    await running;
    expect(flow.getState().status).toBe('done');
    flow.reset();
    expect(flow.getState().status).toBe('idle');
  });
});
