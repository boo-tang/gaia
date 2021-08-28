import useActiveWeb3React from './useActiveWeb3React'
import SimpleStorageABI from '../contracts/SimpleStorage.json'
import useContract from './useContract'
import addresses from '../constants/addresses'

const useSimpleStorage = account => {
  const web3 = useActiveWeb3React()
  const storageContractAddr = addresses.SimpleStorage[web3.chainId]

  return useContract(storageContractAddr, SimpleStorageABI.abi, account)
}

export default useSimpleStorage
