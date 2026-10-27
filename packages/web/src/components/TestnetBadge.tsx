// The "Testnet" badge in the header. Not on a mainnet build.
import { gaiaChain } from '../config/app-config';
import { isTestnet } from '../config/chain';
import { useIsPhone } from '../hooks/useIsPhone';

export const TestnetBadge = () => {
  const isPhone = useIsPhone();
  const { chain } = gaiaChain;
  if (!isTestnet(chain.id)) {
    return undefined;
  }
  return (
    <span className="testnet-badge" title={`${chain.name}: a test network. Its ETH has no value.`}>
      {isPhone ? 'Testnet' : `Testnet · ${chain.name}`}
    </span>
  );
};
