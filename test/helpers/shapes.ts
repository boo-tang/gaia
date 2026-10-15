export type Loc = { lat: number; lng: number };

/// The squares of row `lat` from longitude `from` to `to`, west to east.
export function row(lat: number, from: number, to: number): Loc[] {
  const out: Loc[] = [];
  for (let lng = from; lng <= to; lng++) out.push({ lat, lng });
  return out;
}

/// A rectangle of `rows` x `cols` squares with its south-west square at (lat, lng), in bid order
/// (south to north, then west to east). Each square touches an earlier square.
export function rect(lat: number, lng: number, rows: number, cols: number): Loc[] {
  const out: Loc[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) out.push({ lat: lat + r, lng: lng + c });
  }
  return out;
}
