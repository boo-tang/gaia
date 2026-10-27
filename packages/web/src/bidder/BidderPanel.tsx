// The bidder view (desktop and phone): the refund of the connected wallet, "Withdraw" and the
// shapes of the wallet. A click on a shape moves the map to it.
import { gaiaAuctionAbi, isBefore, selectionExtent, unpackSquare } from '@gaia/core';

import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import { formatEther, isAddressEqual } from 'viem';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';

import { bidderKey, useAuction, useBidder } from '../api/queries';
import { bidFlow } from '../bid/bid-flow';
import { formatTime } from '../components/auction-status';
import { deployment, gaiaChain } from '../config/app-config';
import { cameraRequests } from '../map/camera-request';
import { TxLink } from '../tx/TxLink';
import { runTx } from '../tx/tx-flow';
import { type ShapeSummary, summarizeShapes } from './shape-summary';
import { withdrawFlow, withdrawSteps } from './withdraw-flow';

const eth = (wei: bigint) => `${formatEther(wei)} ETH`;

const count = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

const showShape = (shape: ShapeSummary) => {
  const area = selectionExtent(shape.bidSquareIds.map(unpackSquare));
  if (area !== undefined) {
    cameraRequests.request(area);
  }
};

const ShapeItem = ({ shape }: { shape: ShapeSummary }) => (
  <li>
    <button type="button" className="shape-item" onClick={() => showShape(shape)}>
      <span className="shape-item-title">
        <strong>Shape {shape.shapeId}</strong> <span className="shape-item-time">{formatTime(shape.timestamp)}</span>
      </span>
      <span>
        {shape.heldCount === 0
          ? 'Outbid on all squares'
          : `Winning bid on ${shape.heldCount.toLocaleString('en-US')} of ${count(shape.bidCount, 'square')}`}
      </span>
      <span className="shape-item-amounts">
        {shape.heldAmount === undefined || shape.paid === undefined
          ? 'Amount not known'
          : `${shape.heldCount > 0 ? `Winning: ${eth(shape.heldAmount)} · ` : ''}Paid: ${eth(shape.paid)}`}
      </span>
    </button>
  </li>
);

const BUTTON_TEXT: Record<string, string> = {
  signing: 'Confirm in your wallet…',
  confirming: 'Withdrawing…',
};

export const BidderPanel = () => {
  const { address, chainId } = useAccount();
  const cancelled = useAuction().data?.status.cancelled === true;
  const bidder = useBidder(address);
  const state = useSyncExternalStore(withdrawFlow.subscribe, withdrawFlow.getState);
  const bidState = useSyncExternalStore(bidFlow.subscribe, bidFlow.getState);
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const refund = bidder.data === undefined ? undefined : BigInt(bidder.data.refund);
  const summary = useMemo(() => (bidder.data === undefined ? undefined : summarizeShapes(bidder.data)), [bidder.data]);
  // The receipt of the last bid came before the server had its event: the view is not current yet.
  const lastBid = bidState.status === 'done' ? bidState.result.bid : undefined;
  const updating =
    lastBid !== undefined &&
    address !== undefined &&
    isAddressEqual(lastBid.bidder, address) &&
    bidder.data !== undefined &&
    (bidder.data.lastEventId === undefined || isBefore(bidder.data.lastEventId, lastBid.id));
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
      {address === undefined && <p className="bid-hint">Connect your wallet.</p>}
      {address !== undefined && bidder.isPending && <p className="bid-hint">Loading…</p>}
      {address !== undefined && bidder.isError && (
        <p className="bid-error">
          Failed to load.{' '}
          <button type="button" className="link-button" onClick={() => void bidder.refetch()}>
            Try again
          </button>
        </p>
      )}
      {refund !== undefined && <p className="bidder-refund">Refund: {eth(refund)}</p>}
      {updating && <p className="bid-hint">Bid confirmed. Updating your bids…</p>}
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
      {summary !== undefined && summary.shapes.length === 0 && <p className="bid-hint">You have no bids yet.</p>}
      {summary !== undefined && summary.shapes.length > 0 && (
        <>
          <p className="shape-totals">
            Winning bids on {count(summary.totals.heldSquares, 'square')} in{' '}
            {count(summary.totals.winningShapes, 'shape')}
            {summary.totals.amountKnown && `: ${eth(summary.totals.heldAmount)}`}
          </p>
          <ul className="shape-list" aria-label="Your shapes">
            {summary.shapes.map(shape => (
              <ShapeItem key={shape.shapeId} shape={shape} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
};
