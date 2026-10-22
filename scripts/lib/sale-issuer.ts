import type { NetworkConnection } from 'hardhat/types/network';
import { getAddress } from 'viem';

/// Grants ISSUER_ROLE in GaiaCountries to the land sale, from `admin` (the holder of
/// DEFAULT_ADMIN_ROLE). `admin` must be an account of the network config. Only for a local node:
/// on Base, the admin multisig sends this grant after the auction ends. Does nothing if the sale
/// already has the role. Returns true if it sent the grant.
export async function grantSaleIssuer(
  connection: Pick<NetworkConnection, 'viem'>,
  countries: `0x${string}`,
  sale: `0x${string}`,
  admin: `0x${string}`,
): Promise<boolean> {
  const { viem } = connection;
  const wallet = (await viem.getWalletClients()).find(w => getAddress(w.account.address) === getAddress(admin));
  if (wallet === undefined) {
    throw new Error(`The admin ${admin} is not an account of this network in hardhat.config.ts.`);
  }
  const gaia = await viem.getContractAt('GaiaCountries', countries, { client: { wallet } });
  const issuerRole = await gaia.read.ISSUER_ROLE();
  if (await gaia.read.hasRole([issuerRole, sale])) return false;
  const hash = await gaia.write.grantRole([issuerRole, sale]);
  await (await viem.getPublicClient()).waitForTransactionReceipt({ hash });
  return true;
}
