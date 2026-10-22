// The wrong-network message, with a button that asks the wallet to switch to the app's chain.
import { useAccount, useSwitchChain } from 'wagmi';

import { gaiaChain } from '../config/app-config';

export const NetworkGuard = () => {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending, error } = useSwitchChain();
  const { chain } = gaiaChain;

  if (!isConnected || chainId === chain.id) {
    return undefined;
  }
  return (
    <div className="notice notice-warning" role="alert">
      <span>
        Wrong network. Gaia uses {chain.name} (chain ID {chain.id}).
      </span>
      <button type="button" disabled={isPending} onClick={() => switchChain({ chainId: chain.id })}>
        {isPending ? 'Switching…' : 'Switch network'}
      </button>
      {error !== null && <span className="notice-error">{error.message.split('\n')[0]}</span>}
    </div>
  );
};
