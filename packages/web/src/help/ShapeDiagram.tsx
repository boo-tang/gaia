// A small drawing of squares for the auction rules. It shows fixed examples only: the app does not
// check shapes (the bid simulation gives the contract error).

/**
 * One string for each row, north first. `#`: a square of the bid. `o`: a square of another
 * bidder's shape. `x`: a square that the bid takes from that shape. `.`: no square.
 */
export type DiagramRows = readonly string[];

const CELL = 12;
const GAP = 2;

const CELL_CLASS: Record<string, string | undefined> = {
  '#': 'diagram-bid',
  x: 'diagram-bid',
  o: 'diagram-other',
};

interface ShapeDiagramProps {
  rows: DiagramRows;
  valid: boolean;
  label: string;
}

export const ShapeDiagram = ({ rows, valid, label }: ShapeDiagramProps) => {
  const columns = Math.max(...rows.map(row => row.length));
  const width = columns * (CELL + GAP) - GAP;
  const height = rows.length * (CELL + GAP) - GAP;
  return (
    <figure className={`diagram ${valid ? 'diagram-valid' : 'diagram-invalid'}`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {rows.flatMap((row, y) =>
          [...row].map((cell, x) => (
            <rect
              key={`${x}-${y}`}
              x={x * (CELL + GAP)}
              y={y * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              className={CELL_CLASS[cell] ?? 'diagram-empty'}
            />
          )),
        )}
      </svg>
      <figcaption>
        <span className="diagram-mark">{valid ? '✓' : '✗'}</span> {label}
      </figcaption>
    </figure>
  );
};
