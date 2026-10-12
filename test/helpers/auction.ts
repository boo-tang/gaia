type Loc = { lat: number; lng: number };

/// Packs squares as `bidOnShape` takes them: `(lat << 16) | lng`.
export const pack = (locs: readonly Loc[]): number[] =>
  locs.map(({ lat, lng }) => lat * 65536 + lng);
