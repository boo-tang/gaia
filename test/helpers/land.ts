import hre from "hardhat";
import { encodeFunctionData, zeroHash } from "viem";

export const squareId = (lat: number, lng: number) =>
  BigInt(lat) * 36000n + BigInt(lng);

/// Deploys the ERC-6551 registry, the country account implementation, GaiaCountries and
/// GaiaSquares, and links them. `admin` must be the default wallet.
export async function deployLand(admin: `0x${string}`) {
  const registry = await hre.viem.deployContract("ERC6551Registry");
  const accountImpl = await hre.viem.deployContract("GaiaCountryAccount");
  const countries = await hre.viem.deployContract("GaiaCountries", [
    admin,
    registry.address,
    accountImpl.address,
  ]);
  const squares = await hre.viem.deployContract("GaiaSquares", [
    countries.address,
  ]);
  await countries.write.setSquares([squares.address]);
  return { registry, accountImpl, countries, squares };
}

type Land = Awaited<ReturnType<typeof deployLand>>;

/// Deploys the account of a country through the registry and returns its address.
export async function deployAccount(land: Land, countryId: bigint) {
  const publicClient = await hre.viem.getPublicClient();
  const chainId = BigInt(await publicClient.getChainId());
  await land.registry.write.createAccount([
    land.accountImpl.address,
    zeroHash,
    chainId,
    land.countries.address,
    countryId,
  ]);
  return land.countries.read.accountOf([countryId]);
}

/// Makes a country account (controlled by `wallet`) call transferFrom on GaiaSquares.
export async function accountTransferSquare(
  land: Land,
  wallet: Awaited<ReturnType<typeof hre.viem.getWalletClients>>[number],
  account: `0x${string}`,
  to: `0x${string}`,
  lat: number,
  lng: number
) {
  const asOwner = await hre.viem.getContractAt("GaiaCountryAccount", account, {
    client: { wallet },
  });
  const data = encodeFunctionData({
    abi: land.squares.abi,
    functionName: "transferFrom",
    args: [account, to, squareId(lat, lng)],
  });
  return asOwner.write.execute([land.squares.address, 0n, data, 0]);
}
