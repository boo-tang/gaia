import React, { useCallback, useEffect, useState } from 'react'
import { Button, Input } from '@chakra-ui/react'
import { BigNumber } from '@ethersproject/bignumber'

import useActiveWeb3React from '../hooks/useActiveWeb3React'
import useSimpleStorage from '../hooks/useSimpleStorage'

export const SimpleStorageTest = () => {
  const { account } = useActiveWeb3React()
  const [state, setState] = useState('')
  const [chainValue, setChainValue] = useState(0)
  const [isUpdating, setUpdating] = useState(false)
  const SimpleStorage = useSimpleStorage(account)

  const getValue = useCallback(async () => {
    const val = await SimpleStorage.get()
    return val
  }, [SimpleStorage])

  const setValue = async () => {
    setUpdating(true)
    const result = await SimpleStorage.set(BigNumber.from(state))
    console.log('SimpleStorage.set result', result)
    result.wait().then(() => setUpdating(false))
  }

  useEffect(() => {
    const fn = async () => {
      if (account && !isUpdating) {
        const value = await getValue()
        setChainValue(value.toNumber())
      }
    }
    fn()
  }, [account, getValue, isUpdating])

  return (
    <div>
      {account && (
        <div style={{ marginTop: '5vh' }}>
          <Input
            placeholder="Set contract value"
            size="lg"
            value={state}
            onChange={e => setState(e.target.value)}
          />
          <Button onClick={setValue}>Set Value</Button>
          Storage Value: {chainValue}
        </div>
      )}
    </div>
  )
}
