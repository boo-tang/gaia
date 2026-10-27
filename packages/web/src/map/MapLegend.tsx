// The map legend at the bottom right: the bid colours and, with the selection, the selection colours.
// It takes the colours from the layers, so the two always match. On a phone it starts closed.
import type { CSSProperties } from 'react';

import { useIsPhone } from '../hooks/useIsPhone';
import { BIDDER_COLORS, OWN_COLOR } from './bidder-colors';
import { BID_ALPHA, OWN_GREEN, SELECTION_ALPHA, SELECTION_RED } from './layers';

const rgba = ([r, g, b]: readonly [number, number, number], alpha: number) => `rgb(${r} ${g} ${b} / ${alpha / 255})`;

const swatch = (background: string): CSSProperties => ({ background });

// Some colours of the other bidders, to show that each bidder has one.
const OTHER_SAMPLES = BIDDER_COLORS.slice(0, 4);

export const MapLegend = ({ showSelection }: { showSelection: boolean }) => {
  const isPhone = useIsPhone();
  return (
    <details className="map-legend" open={!isPhone}>
      <summary>Legend</summary>
      <ul>
        <li>
          <span className="legend-swatch" style={swatch(rgba(OWN_COLOR, BID_ALPHA))} />
          Your bids
        </li>
        <li>
          <span className="legend-swatches">
            {OTHER_SAMPLES.map(color => (
              <span key={color.join()} className="legend-swatch" style={swatch(rgba(color, BID_ALPHA))} />
            ))}
          </span>
          Other bidders (one colour each)
        </li>
        {showSelection && (
          <>
            <li>
              <span
                className="legend-swatch legend-swatch-wide"
                style={swatch(
                  `linear-gradient(to right, ${rgba(SELECTION_RED, SELECTION_ALPHA.low)}, ${rgba(SELECTION_RED, SELECTION_ALPHA.high)})`,
                )}
              />
              Selected: low to high cost
            </li>
            <li>
              <span className="legend-swatch" style={swatch(rgba(OWN_GREEN, SELECTION_ALPHA.own))} />
              Selected: already yours
            </li>
          </>
        )}
      </ul>
    </details>
  );
};
