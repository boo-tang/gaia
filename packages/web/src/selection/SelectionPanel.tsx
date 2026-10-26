// The bid panel: the selected squares, the price, the total and the Bid button (the
// bid flow is in src/bid/).
import { rectangleSize, selectionExtent } from '@gaia/core';

import { useMemo } from 'react';
import { formatEther } from 'viem';
import { useAccount } from 'wagmi';

import { BidButton, BidStatus } from '../bid/BidButton';
import { useBid } from '../bid/useBid';
import { selectionStore, useSelection } from './useSelection';

const eth = (wei: bigint) => `${formatEther(wei)} ETH`;
const count = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

export const SelectionPanel = () => {
  const { priceMode, priceText, pricePerSquare } = useSelection(state => state);
  const placing = useBid();
  const bid = placing.input;
  const { address } = useAccount();
  const { priced } = bid;

  const extent = useMemo(() => {
    const area = priced === undefined ? undefined : selectionExtent(priced.sorted);
    return area === undefined ? undefined : rectangleSize(area);
  }, [priced]);

  // The cost range of the squares that are not own squares.
  const costRange = useMemo(() => {
    if (priced === undefined) {
      return undefined;
    }
    const costs = priced.costs.filter((_, i) => !priced.own[i]);
    if (costs.length === 0) {
      return undefined;
    }
    return costs.reduce(
      ([low, high], cost) => [cost < low ? cost : low, cost > high ? cost : high],
      [costs[0], costs[0]],
    );
  }, [priced]);

  const changePrice = (text: string) => selectionStore.setPriceText(text);

  return (
    <section className="bid-panel" aria-label="Bid">
      <h2 className="panel-title">Bid</h2>

      {bid.squareCount === 0 ? (
        <p className="bid-summary">
          Select squares on the map: click a square, or click two corners with the rectangle tool (R). A click on a
          selected square removes it.
        </p>
      ) : (
        <p className="bid-summary">
          {count(bid.squareCount, 'square')}
          {extent !== undefined && ` (${count(extent.rows, 'row')}, ${count(extent.columns, 'column')})`}
        </p>
      )}

      <fieldset className="bid-price">
        <legend>Price</legend>
        <label>
          <input
            type="radio"
            name="price-mode"
            checked={priceMode === 'minimum'}
            onChange={() => selectionStore.setPriceMode('minimum')}
          />{' '}
          Minimum bid
        </label>
        <label>
          <input
            type="radio"
            name="price-mode"
            checked={priceMode === 'perSquare'}
            onChange={() => selectionStore.setPriceMode('perSquare')}
          />{' '}
          Set price per square
        </label>
        {priceMode === 'perSquare' && (
          <div className="bid-price-input">
            <label>
              <input
                type="text"
                inputMode="decimal"
                aria-label="Price per square in ETH"
                placeholder="0.01"
                value={priceText}
                onChange={event => changePrice(event.target.value)}
              />{' '}
              ETH per square
            </label>
            {priced !== undefined && priced.minPricePerSquare > 0n && (
              <p className="bid-hint">
                At least {eth(priced.minPricePerSquare)} per square.{' '}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => changePrice(formatEther(priced.minPricePerSquare))}
                >
                  Use minimum
                </button>
              </p>
            )}
            {priceText !== '' && pricePerSquare === undefined && <p className="bid-error">Enter a price in ETH.</p>}
            {pricePerSquare !== undefined && priced?.priceTooLow === true && (
              <p className="bid-error">The price must be at least {eth(priced.minPricePerSquare)}.</p>
            )}
          </div>
        )}
      </fieldset>

      {priced !== undefined && (
        <div className="bid-total">
          {bid.loading && <p>Loading the prices of {count(priced.missingCount, 'square')}…</p>}
          {bid.loadFailed && (
            <p className="bid-error">
              Cannot load the prices of {count(priced.missingCount, 'square')}.{' '}
              <button type="button" className="link-button" onClick={bid.retry}>
                Try again
              </button>
            </p>
          )}
          {bid.total !== undefined && <p className="bid-total-value">Total: {eth(bid.total)}</p>}
          <p>
            {[
              priced.newCount > 0 && count(priced.newCount, 'new square'),
              priced.outbidCount > 0 && count(priced.outbidCount, 'outbid square'),
              priced.ownCount > 0 && `${priced.ownCount.toLocaleString('en-US')} of your squares (0 ETH)`,
            ]
              .filter(Boolean)
              .join(', ')}
          </p>
          {priceMode === 'minimum' && costRange !== undefined && priced.missingCount === 0 && (
            <p>
              {costRange[0] === costRange[1]
                ? `${eth(costRange[0])} per square`
                : `${formatEther(costRange[0])} to ${eth(costRange[1])} per square`}
            </p>
          )}
          {address === undefined && <p className="bid-hint">Connect a wallet to see your own squares.</p>}
        </div>
      )}

      {priced !== undefined && priced.cuts.length > 0 && (
        <div className="bid-cuts">
          <p>Takes squares from {count(priced.cuts.length, 'shape')}:</p>
          <ul>
            {priced.cuts.map(cut => (
              <li key={cut.shapeId}>
                Shape {cut.shapeId} ({shortAddress(cut.bidder)}): {count(cut.squareCount, 'square')}
                {cut.own && ' (yours)'}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bid-actions">
        <button type="button" onClick={() => selectionStore.clear()} disabled={bid.squareCount === 0}>
          Clear
        </button>
        <BidButton bid={placing} />
      </div>
      <BidStatus bid={placing} />
    </section>
  );
};
