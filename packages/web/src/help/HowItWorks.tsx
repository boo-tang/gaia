// The text of the "How it works" panel: the auction in short, the countries after the auction and, on
// a testnet, how to get test ETH.
import type { AuctionResponse } from '@gaia/core';

import { useAuction } from '../api/queries';
import { describeAuction, formatDuration, formatTime } from '../components/auction-status';
import { gaiaChain } from '../config/app-config';
import { isTestnet } from '../config/chain';
import { useIsPhone } from '../hooks/useIsPhone';
import { useNowSeconds } from '../hooks/useNowSeconds';
import { ShapeDiagram } from './ShapeDiagram';

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
        <li>After the end, each winning shape becomes a country. See &quot;After the auction&quot; below.</li>
      </ol>
      <h3>After the auction</h3>
      <p>Each winning shape is settled into a country. The winner gets two kinds of NFT:</p>
      <ul>
        <li>A country NFT. The owner of the country NFT controls the country.</li>
        <li>
          One NFT for each square. The squares are kept in the account of the country, not in your wallet. Each country
          has its own account.
        </li>
      </ul>
      <p>
        Each winning shape becomes its own country, also when two of your shapes touch. You can move squares from one of
        your countries into another.
      </p>
      <p>
        A country can change its shape, but it must always be one connected area with no holes. The auction rules for
        shape, size and length do not apply after the auction.
      </p>
      <ul>
        <li>
          Split: move a square from the country to your wallet. It becomes a single square that is not part of a
          country. A split that cuts the country in two or makes a hole is not valid.
        </li>
        <li>
          Merge: move a square from your wallet into a country that you own. It must touch the country and must not make
          a hole.
        </li>
        <li>Sell or send a country: it goes with everything in its account.</li>
        <li>Sell or send a square: split it first. The new owner merges it into their own country.</li>
      </ul>
      <p className="diagram-key">
        <span className="diagram-swatch diagram-other" /> a country <span className="diagram-swatch diagram-bid" /> a
        square that moves to your wallet
      </p>
      <div className="diagram-row">
        <ShapeDiagram rows={['o.o', 'o.o', 'ooo']} valid label="U shape" />
        <ShapeDiagram rows={['ooo', 'o..', 'ooo', '..o', 'ooo']} valid label="S shape" />
        <ShapeDiagram rows={['ooo', 'ooo', 'oox']} valid label="Split a corner" />
        <ShapeDiagram rows={['ooxoo']} valid={false} label="Cuts the country in two" />
        <ShapeDiagram rows={['ooo', 'oxo', 'ooo']} valid={false} label="Makes a hole" />
      </div>
      <p>
        When the last square leaves a country, the country NFT is burned. Anything that is still in its account is
        locked forever.
      </p>
      <p>
        Squares that nobody won go on sale after the auction. Their price falls with time. You can buy them as a new
        country or add them to a country that you own.
      </p>
      {isPhone && <p>On a phone you can view the auction. Bid on a desktop.</p>}
      {isTestnet(chain.id) && (
        <>
          <h3>Test network</h3>
          {faucets === undefined ? (
            <p>
              This auction runs on {chain.name}. Import an Anvil test key in your wallet: its accounts have test ETH.
            </p>
          ) : (
            <>
              <p>This auction runs on {chain.name}. You can get test ETH here:</p>
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
