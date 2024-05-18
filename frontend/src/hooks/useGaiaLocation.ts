import {
  useChainId,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';

import GaiaLocationABI from '../../artifacts/contracts/Gaia_Location.sol/Gaia_Location.json';
import addresses from '../constants/addresses';
import { fromCoorToUint } from '../utils/location';
import { Loc } from '../types';

const useGaiaLocation = (account: string) => {
  const chainId = useChainId();
  const { writeContractAsync } = useWriteContract();

  const mintLocations = async (selectedLocations: Loc[]) => {
    const locations = selectedLocations.map((_loc) => {
      const loc = fromCoorToUint(_loc);
      return [loc.lat, loc.lng];
    });
    const hash = await writeContractAsync({
      abi: GaiaLocationABI.abi,
      address: addresses.GaiaLocation[chainId || 1337],
      functionName: 'mintMultipleLocations',
      args: [locations],
    });

    const { isLoading: isConfirming, isSuccess: isConfirmed } =
      useWaitForTransactionReceipt({
        hash,
      });
  };

  const getUserBalance = () =>
    useReadContract({
      abi: GaiaLocationABI.abi,
      address: addresses.GaiaLocation[chainId || 1337],
      functionName: 'balanceOf',
      args: [account],
    });

  const getUserLocations = () =>
    useReadContract({
      abi: GaiaLocationABI.abi,
      address: addresses.GaiaLocation[chainId || 1337],
      functionName: 'getUserLocations',
      args: [account],
    });

  const getOwnedLocationsInBounds = (minLoc: Loc, maxLoc: Loc) =>
    useReadContract({
      abi: GaiaLocationABI.abi,
      address: addresses.GaiaLocation[chainId || 1337],
      functionName: 'getOwnedLocationsInBounds',
      args: [minLoc.lat, minLoc.lng, maxLoc.lat, maxLoc.lng],
    });

  return {
    mintLocations,
    getUserBalance,
    getUserLocations,
    getOwnedLocationsInBounds,
  };
};

export default useGaiaLocation;
