import { getAddress } from '@ethersproject/address'

// returns the checksummed address if the address is valid, otherwise returns false
export function isAddress(value: string) {
  try {
    return !!getAddress(value)
  } catch {
    return false
  }
}
