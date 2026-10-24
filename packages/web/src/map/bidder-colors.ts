// The colour of a bidder on the map. Each address always gets the same colour. The connected
// wallet has its own colour, which no other bidder gets.

export type Rgb = readonly [number, number, number];

// Tableau 10 without its orange (the own colour).
const BIDDER_COLORS: readonly Rgb[] = [
  [78, 121, 167],
  [225, 87, 89],
  [118, 183, 178],
  [89, 161, 79],
  [237, 201, 72],
  [176, 122, 161],
  [255, 157, 167],
  [156, 117, 95],
  [186, 176, 172],
];

export const OWN_COLOR: Rgb = [242, 142, 43];

// FNV-1a over the lower-case address.
const hash = (text: string) => {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
};

/** The colour of `bidder`. `own`: the connected wallet, if there is one. */
export const bidderColor = (bidder: string, own: string | undefined): Rgb => {
  const address = bidder.toLowerCase();
  if (own !== undefined && address === own.toLowerCase()) {
    return OWN_COLOR;
  }
  return BIDDER_COLORS[hash(address) % BIDDER_COLORS.length];
};
