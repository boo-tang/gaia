// The text of the "How it works" panel: the auction in short and, on a testnet, how to get test ETH.
import type { AuctionResponse } from '@gaia/core';

import { useAuction } from '../api/queries';
import { describeAuction, formatDuration, formatTime } from '../components/auction-status';
import { gaiaChain } from '../config/app-config';
import { isTestnet } from '../config/chain';
import { useIsPhone } from '../hooks/useIsPhone';
import { useNowSeconds } from '../hooks/useNowSeconds';

// "15 minutes" for 900 s; other durations as "2 h 10 min".
const windowText = (seconds: number) =>
  seconds % 60 === 0 && seconds < 3600 ? `${seconds / 60} minutes` : formatDuration(seconds);

const EndText = ({ auction, now }: { auction: AuctionResponse; now: number }) => {
  const { rules, status } = auction;
  const { phase } = describeAuction(auction, now);
  if (phase === 'cancelled') {
    return <>The auction is cancelled. Each bidder can withdraw all their ETH.</>;
  }
  const extension = windowText(rules.extensionWindow);
  return (
    <>
      {phase === 'ended' ? 'The auction ended' : 'The auction ends'} {formatTime(status.endTime)}
      {phase === 'paused' && ' (it is paused now)'}. A bid in the last {extension} moves the end, for all squares, to{' '}
      {extension} after that bid. The end never goes past {formatTime(rules.maxEndTime)}.
    </>
  );
};

export const HowItWorks = () => {
  const auction = useAuction();
  const now = useNowSeconds();
  const isPhone = useIsPhone();
  const { chain, faucets } = gaiaChain;

  return (
    <div className="help-text">
      <p>
        Gaia sells the land of the world as squares on a map. A shape is a group of squares that touch edge to edge,
        with no holes.
      </p>
      <ol>
        <li>
          Select squares with the drawing tools at the top left of the map. The bid panel shows the total. Click
          &quot;Bid&quot;.
          {!isPhone && ' "Auction rules" in the bid panel shows which shapes are valid.'}
        </li>
        <li>
          A higher bid takes squares from the earlier bidder. The outbid ETH goes to your refund. &quot;Withdraw&quot;
          in &quot;Your bids&quot; sends it to your wallet.
        </li>
        <li>
          {auction.data === undefined ? (
            'The status bar at the top shows the end of the auction.'
          ) : (
            <EndText auction={auction.data} now={now} />
          )}
        </li>
        <li>After the end, each winning shape becomes a country NFT for its bidder.</li>
      </ol>
      {isPhone && <p>On a phone you can view the auction. Bid on a desktop.</p>}
      {isTestnet(chain.id) && (
        <>
          <h3>Test network</h3>
          <p>
            This auction runs on {chain.name}, a test network. Its ETH has no value. Your wallet must be on {chain.name}
            . The app asks to switch it.
          </p>
          {faucets === undefined ? (
            <p>Import an Anvil test key in your wallet: its accounts have test ETH.</p>
          ) : (
            <>
              <p>Get test ETH:</p>
              <ul>
                {faucets.map(faucet => (
                  <li key={faucet.url}>
                    <a href={faucet.url} target="_blank" rel="noreferrer">
                      {faucet.name}
                    </a>
                    {faucet.note !== undefined && ` (${faucet.note})`}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
};
