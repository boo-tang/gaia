import hre from 'hardhat';
import type { NetworkConnection } from 'hardhat/types/network';
import { getAddress } from 'viem';

/// The canonical ERC-6551 registry address (EIP-6551, erc6551 package README). It is the same on
/// each chain, Base too. GaiaCountries.accountOf uses this address, so a local deployment puts the
/// registry here and gets the same account addresses as on Base.
export const CANONICAL_REGISTRY = getAddress('0x000000006551c19487814612e58FE06813775758');

/// Puts the runtime bytecode of the compiled ERC6551Registry at CANONICAL_REGISTRY, if that address
/// has no code. Only for a local node (Anvil or the in-process network). The bytecode is not byte
/// for byte the deployed one (other compiler settings), but the registry has no state and no
/// immutables, so it computes and creates the same accounts. Returns true if it set the code.
export async function ensureRegistry(connection: Pick<NetworkConnection, 'viem' | 'provider'>): Promise<boolean> {
  const publicClient = await connection.viem.getPublicClient();
  const code = await publicClient.getCode({ address: CANONICAL_REGISTRY });
  if (code !== undefined && code !== '0x') return false;
  const artifact = await hre.artifacts.readArtifact('ERC6551Registry');
  // Anvil and the Hardhat network both accept hardhat_setCode (Anvil: alias of anvil_setCode).
  await connection.provider.request({
    method: 'hardhat_setCode',
    params: [CANONICAL_REGISTRY, artifact.deployedBytecode],
  });
  return true;
}
