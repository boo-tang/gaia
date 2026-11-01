// Square orders for settleShapeInto and moveSquares. GaiaSquares adds and removes squares one at
// a time, and each square must keep each country connected and without holes. The real order
// builder is in packages/core; these helpers are only for the tests.

type Loc = { lat: number; lng: number };

const LAT_ROWS = 18000;
const LNG_COLUMNS = 36000;

const keyOf = ({ lat, lng }: Loc) => lat * LNG_COLUMNS + lng;
const wrap = (lng: number) => ((lng % LNG_COLUMNS) + LNG_COLUMNS) % LNG_COLUMNS;

/// The rule of GaiaSquares._checkShape: true if square `p` is a simple point of `set` (`set` does
/// not hold `p`), that is, Yokoi's 4-connectivity number of its 8 neighbours is 1.
export function isSimplePoint(set: ReadonlySet<number>, p: Loc): boolean {
  const at = (dLat: number, dLng: number) => {
    const lat = p.lat + dLat;
    if (lat < 0 || lat >= LAT_ROWS) return false;
    return set.has(lat * LNG_COLUMNS + wrap(p.lng + dLng));
  };
  // E, NE, N, NW, W, SW, S, SE.
  const ring = [at(0, 1), at(1, 1), at(1, 0), at(1, -1), at(0, -1), at(-1, -1), at(-1, 0), at(-1, 1)];
  let nc = 0;
  for (let k = 0; k < 8; k += 2) {
    if (ring[k] && !(ring[k + 1] && ring[(k + 2) % 8])) nc++;
  }
  return nc === 1;
}

/// A greedy order: next, any square that is a simple point of the destination and, for a move,
/// also of the rest of the source. `dest` and `source` are the squares of the two countries
/// before the move (`source` holds `squares`). Without `source`, the squares are new (a mint).
/// The first square of an empty destination and the last square of a source are always allowed.
/// Returns undefined if the greedy search gets stuck.
export function greedyOrder(squares: readonly Loc[], dest: readonly Loc[], source?: readonly Loc[]): Loc[] | undefined {
  const to = new Set(dest.map(keyOf));
  const from = source === undefined ? undefined : new Set(source.map(keyOf));
  const rest = [...squares];
  const out: Loc[] = [];
  while (rest.length > 0) {
    const i = rest.findIndex(p => {
      if (to.size !== 0 && !isSimplePoint(to, p)) return false;
      if (from === undefined || from.size === 1) return true;
      const without = new Set(from);
      without.delete(keyOf(p));
      return isSimplePoint(without, p);
    });
    if (i < 0) return undefined;
    const [p] = rest.splice(i, 1);
    out.push(p);
    to.add(keyOf(p));
    from?.delete(keyOf(p));
  }
  return out;
}

/// The global rule, with flood fill and not with the local check of the contract: the squares
/// are 4-connected, and each empty square reaches the outside through empty squares with
/// 8-connectivity. Rows beyond the poles are outside. The squares must span less than half of
/// the longitudes.
export function isConnectedWithoutHoles(squares: readonly Loc[]): boolean {
  if (squares.length === 0) return true;
  const ref = squares[0].lng;
  // Longitudes relative to the first square, so that a country can cross the antimeridian.
  const rel = (lng: number) => ((lng - ref + LNG_COLUMNS + LNG_COLUMNS / 2) % LNG_COLUMNS) - LNG_COLUMNS / 2;
  const cells = squares.map(s => ({ lat: s.lat, x: rel(s.lng) }));
  const id = (lat: number, x: number) => `${lat},${x}`;
  const set = new Set(cells.map(c => id(c.lat, c.x)));

  // 4-connected.
  const seen = new Set([id(cells[0].lat, cells[0].x)]);
  const stack = [cells[0]];
  while (stack.length > 0) {
    const c = stack.pop()!;
    for (const [dLat, dx] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const k = id(c.lat + dLat, c.x + dx);
      if (set.has(k) && !seen.has(k)) {
        seen.add(k);
        stack.push({ lat: c.lat + dLat, x: c.x + dx });
      }
    }
  }
  if (seen.size !== set.size) return false;

  // No holes: flood the empty squares from the frame around the bounding box.
  const minLat = Math.min(...cells.map(c => c.lat)) - 1;
  const maxLat = Math.max(...cells.map(c => c.lat)) + 1;
  const minX = Math.min(...cells.map(c => c.x)) - 1;
  const maxX = Math.max(...cells.map(c => c.x)) + 1;
  const outside = new Set<string>();
  const queue: { lat: number; x: number }[] = [];
  const enter = (lat: number, x: number) => {
    const k = id(lat, x);
    if (set.has(k) || outside.has(k)) return;
    outside.add(k);
    queue.push({ lat, x });
  };
  for (let x = minX; x <= maxX; x++) {
    enter(minLat, x);
    enter(maxLat, x);
  }
  for (let lat = minLat; lat <= maxLat; lat++) {
    enter(lat, minX);
    enter(lat, maxX);
  }
  while (queue.length > 0) {
    const c = queue.pop()!;
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dx = -1; dx <= 1; dx++) {
        const lat = c.lat + dLat;
        const x = c.x + dx;
        if (lat < minLat || lat > maxLat || x < minX || x > maxX) continue;
        enter(lat, x);
      }
    }
  }
  for (let lat = minLat; lat <= maxLat; lat++) {
    for (let x = minX; x <= maxX; x++) {
      const k = id(lat, x);
      if (!set.has(k) && !outside.has(k)) return false;
    }
  }
  return true;
}

/// Index of the first square of `order` that GaiaSquares rejects when it adds the squares one at
/// a time to a country of `dest`, by the global rule. -1 if each step keeps the country valid.
export function firstBadAdd(order: readonly Loc[], dest: readonly Loc[]): number {
  const now = [...dest];
  for (let i = 0; i < order.length; i++) {
    now.push(order[i]);
    if (now.length > 1 && !isConnectedWithoutHoles(now)) return i;
  }
  return -1;
}
