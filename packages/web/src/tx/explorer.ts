// Links to the block explorer of the chain of the app.
import type { Hash } from 'viem';

import { gaiaChain } from '../config/app-config';

/** The page of a transaction. Undefined when the chain has no explorer (Anvil). */
export const txUrl = (hash: Hash): string | undefined => {
  const explorer = gaiaChain.chain.blockExplorers?.default.url;
  return explorer === undefined ? undefined : `${explorer.replace(/\/+$/, '')}/tx/${hash}`;
};
