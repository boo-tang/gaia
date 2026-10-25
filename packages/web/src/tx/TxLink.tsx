// The link to a transaction in the block explorer. Nothing on a chain with no explorer (Anvil).
import type { Hash } from 'viem';

import { txUrl } from './explorer';

export const TxLink = ({ hash }: { hash: Hash }) => {
  const url = txUrl(hash);
  return url === undefined ? undefined : (
    <a href={url} target="_blank" rel="noreferrer">
      View the transaction
    </a>
  );
};
