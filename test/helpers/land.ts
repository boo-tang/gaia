import { viem } from "./setup";
import { type Abi, type Hex, encodeFunctionData, zeroHash } from "viem";

export const squareId = (lat: number, lng: number) =>
  BigInt(lat) * 36000n + BigInt(lng);

/// Deploys the ERC-6551 registry, the country account implementation, GaiaCountries and
/// GaiaSquares, and links them. `admin` must be the default wallet. `v` is the connection to
/// deploy on (default: the shared connection).
export async function deployLand(admin: `0x${string}`, v = viem) {
  const registry = await v.deployContract("ERC6551Registry");
  const accountImpl = await v.deployContract("GaiaCountryAccount");
  const countries = await v.deployContract("GaiaCountries", [
    admin,
    registry.address,
    accountImpl.address,
  ]);
  const squares = await v.deployContract("GaiaSquares", [
    countries.address,
  ]);
  await countries.write.setSquares([squares.address]);
  return { registry, accountImpl, countries, squares };
}

type Land = Awaited<ReturnType<typeof deployLand>>;

/// Deploys the account of a country through the registry and returns its address.
export async function deployAccount(land: Land, countryId: bigint) {
  const publicClient = await viem.getPublicClient();
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

type Wallet = Awaited<ReturnType<typeof viem.getWalletClients>>[number];

/// Makes a country account (controlled by `wallet`) call `target` with `data` and `value`.
/// The account bubbles up the reverts of `target`, so its ABI is extended with the errors of
/// `target` for viem to name them in the error message. Hardhat's stack traces name them too,
/// but not under --coverage.
export async function executeAs(
  land: Land,
  wallet: Wallet,
  account: `0x${string}`,
  target: { address: `0x${string}`; abi: Abi },
  data: Hex,
  value = 0n
) {
  const abi = [
    ...land.accountImpl.abi,
    ...target.abi.filter((item) => item.type === "error"),
  ];
  return wallet.writeContract({
    address: account,
    abi,
    functionName: "execute",
    args: [target.address, value, data, 0],
    value,
  });
}

/// Makes a country account (controlled by `wallet`) call transferFrom on GaiaSquares.
export async function accountTransferSquare(
  land: Land,
  wallet: Wallet,
  account: `0x${string}`,
  to: `0x${string}`,
  lat: number,
  lng: number
) {
  const data = encodeFunctionData({
    abi: land.squares.abi,
    functionName: "transferFrom",
    args: [account, to, squareId(lat, lng)],
  });
  return executeAs(land, wallet, account, land.squares, data);
}
