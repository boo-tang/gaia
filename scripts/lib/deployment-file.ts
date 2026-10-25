import fs from 'node:fs';
import path from 'node:path';
import { getAddress } from 'viem';

import { CANONICAL_REGISTRY } from './registry';

type Address = `0x${string}`;

/// The contracts of GaiaSystemModule, as `connection.ignition.deploy` returns them.
export type SystemContracts = Record<
  'accountImplementation' | 'countries' | 'squares' | 'auction' | 'sale' | 'market',
  { address: Address }
>;

/// Writes the deployment file (the format of packages/core/src/deployment.ts) and prints its
/// content.
export function writeDeploymentFile(
  file: string,
  values: {
    chainId: number;
    deployBlock: number;
    contracts: SystemContracts;
    admin: string;
    treasury: string;
    auction: { startTime: bigint; endTime: bigint; maxEndTime: bigint };
  },
) {
  const { accountImplementation, countries, squares, auction, sale, market } = values.contracts;
  const out = {
    chainId: values.chainId,
    deployBlock: values.deployBlock,
    contracts: {
      GaiaCountries: countries.address,
      GaiaSquares: squares.address,
      GaiaCountryAccount: accountImplementation.address,
      GaiaAuction: auction.address,
      GaiaLandSale: sale.address,
      GaiaCountryMarket: market.address,
      ERC6551Registry: CANONICAL_REGISTRY,
    },
    admin: getAddress(values.admin),
    treasury: getAddress(values.treasury),
    auction: {
      startTime: Number(values.auction.startTime),
      endTime: Number(values.auction.endTime),
      maxEndTime: Number(values.auction.maxEndTime),
    },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);

  const iso = (s: number) => new Date(s * 1000).toISOString();
  console.log(`
Gaia is deployed on chain ${out.chainId} (from block ${out.deployBlock}).
${Object.entries(out.contracts)
  .map(([name, address]) => `  ${name.padEnd(20)} ${address}`)
  .join('\n')}
  admin                ${out.admin}
  treasury             ${out.treasury}
  auction start        ${iso(out.auction.startTime)}
  auction end          ${iso(out.auction.endTime)} (max ${iso(out.auction.maxEndTime)})
Addresses: ${file}`);
}
