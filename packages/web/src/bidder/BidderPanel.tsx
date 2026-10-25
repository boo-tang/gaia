// The bidder view (desktop and phone): the refund of the connected wallet and "Withdraw".
import { gaiaAuctionAbi } from '@gaia/core';

import { useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { formatEther } from 'viem';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';

import { bidderKey, useAuction, useBidder } from '../api/queries';
import { deployment, gaiaChain } from '../config/app-config';
import { TxLink } from '../tx/TxLink';
import { runTx } from '../tx/tx-flow';
import { withdrawFlow, withdrawSteps } from './withdraw-flow';

const eth = (wei: bigint) => `${formatEther(wei)} ETH`;

const BUTTON_TEXT: Record<string, string> = {
  signing: 'Confirm in your wallet…',
  confirming: 'Withdrawing…',
};

export const BidderPanel = () => {
  const { address, chainId } = useAccount();
  const cancelled = useAuction().data?.status.cancelled === true;
  const bidder = useBidder(address);
  const state = useSyncExternalStore(withdrawFlow.subscribe, withdrawFlow.getState);
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const refund = bidder.data === undefined ? undefined : BigInt(bidder.data.refund);
  const canWithdraw =
    address !== undefined &&
    chainId === gaiaChain.chain.id &&
    publicClient !== undefined &&
    refund !== undefined &&
    refund > 0n &&
    !withdrawFlow.busy();

  const withdraw = () => {
    if (!canWithdraw) {
      return;
    }
    void runTx(
      withdrawFlow,
      withdrawSteps(
        address,
        {
          write: () =>
            writeContractAsync({
              address: deployment.contracts.GaiaAuction,
              abi: gaiaAuctionAbi,
              functionName: 'withdraw',
              chainId: gaiaChain.chain.id,
            }),
          waitForReceipt: hash => publicClient.waitForTransactionReceipt({ hash }),
        },
        () => void queryClient.invalidateQueries({ queryKey: bidderKey(address) }),
      ),
    );
  };

  return (
    <section className="bidder-view" aria-label="Your bids">
      <h2 className="panel-title">Your bids</h2>
      {cancelled && <p className="bid-error">The auction is cancelled. Withdraw your bids.</p>}
      {address === undefined && <p className="bid-hint">Connect a wallet to see your refund.</p>}
      {address !== undefined && bidder.isPending && <p className="bid-hint">Loading your refund…</p>}
      {address !== undefined && bidder.isError && (
        <p className="bid-error">
          Cannot load your refund.{' '}
          <button type="button" className="link-button" onClick={() => void bidder.refetch()}>
            Try again
          </button>
        </p>
      )}
      {refund !== undefined && <p className="bidder-refund">Refund: {eth(refund)}</p>}
      <button type="button" className="withdraw-button" disabled={!canWithdraw} onClick={withdraw}>
        {BUTTON_TEXT[state.status] ?? 'Withdraw'}
      </button>
      <div className="bid-status" aria-live="polite">
        {state.status === 'confirming' && (
          <p className="bid-hint">
            <TxLink hash={state.hash} />
          </p>
        )}
        {state.status === 'done' && (
          <p className="bid-done">
            Withdrawn: {eth(state.result)} <TxLink hash={state.hash} />
          </p>
        )}
        {state.status === 'failed' && (
          <p className="bid-error" role="alert" title={state.detail}>
            {state.text}
          </p>
        )}
        {address !== undefined && chainId !== gaiaChain.chain.id && (
          <p className="bid-hint">Switch your wallet to {gaiaChain.chain.name}.</p>
        )}
      </div>
    </section>
  );
};
