// The text of the "Auction rules" panel: the shape rules of the contract, with the values of this
// auction and examples.
import { useAuction } from '../api/queries';
import { type DiagramRows, ShapeDiagram } from './ShapeDiagram';

interface Example {
  rows: DiagramRows;
  label: string;
}

const VALID: readonly Example[] = [
  { rows: ['###', '###'], label: 'Rectangle' },
  { rows: ['#..', '#..', '###'], label: 'L' },
  { rows: ['.#.', '###', '.#.'], label: 'Plus' },
];

const NOT_VALID: readonly Example[] = [
  { rows: ['###', '#.#', '###'], label: 'Hole' },
  { rows: ['#.#', '###'], label: 'Gap in a row' },
  { rows: ['#.', '.#'], label: 'Corners only' },
];

// The longest bar that this page draws for the aspect ratio.
const MAX_BAR = 20;

export const AuctionRules = () => {
  const auction = useAuction();
  if (auction.data === undefined) {
    return <p>Loading the rules…</p>;
  }
  const { minShapeSquares, maxShapeSquares, maxShapeAspectRatio } = auction.data.rules;
  const bar = maxShapeAspectRatio + 1;

  return (
    <div className="help-text">
      <p>
        Each bid is one shape. The contract checks the shape. When it is not valid, the app shows the error before your
        wallet opens.
      </p>
      <ul>
        <li>
          A shape has {minShapeSquares.toLocaleString('en-US')} to {maxShapeSquares.toLocaleString('en-US')} squares.
        </li>
        <li>
          Each row and each column of the shape is one unbroken line of squares, and the rows touch each other. So a
          shape has no gaps and no holes.
        </li>
        <li>The long side of the box around the shape is at most {maxShapeAspectRatio} times its short side.</li>
        <li>
          Your bid can take squares from another shape only when the rest of that shape is still a valid shape, or when
          no squares of it stay.
        </li>
      </ul>

      <h3>Valid</h3>
      <div className="diagram-row">
        {VALID.map(example => (
          <ShapeDiagram key={example.label} rows={example.rows} valid label={example.label} />
        ))}
      </div>

      <h3>Not valid</h3>
      <div className="diagram-row">
        {NOT_VALID.map(example => (
          <ShapeDiagram key={example.label} rows={example.rows} valid={false} label={example.label} />
        ))}
        {bar <= MAX_BAR && <ShapeDiagram rows={['#'.repeat(bar)]} valid={false} label={`1 × ${bar}: too long`} />}
      </div>

      <h3>Taking squares from another shape</h3>
      <p>
        The squares that stay in the other shape must still be a valid shape. A bid that leaves a gap, a hole or two
        pieces in it is not valid, also when your own squares are a valid shape.
      </p>
      <p className="diagram-key">
        <span className="diagram-swatch diagram-other" /> another bidder&apos;s shape{' '}
        <span className="diagram-swatch diagram-bid" /> your bid
      </p>
      <div className="diagram-row">
        <ShapeDiagram rows={['ooox', 'ooox', 'ooox']} valid label="Takes the east column" />
        <ShapeDiagram rows={['oooo', 'ooox', 'oooo']} valid={false} label="Leaves a gap in a column" />
        <ShapeDiagram rows={['oxoo', 'oxoo', 'oxoo']} valid={false} label="Cuts the shape in two" />
      </div>
    </div>
  );
};
