// The connect, account and disconnect button of the wallet kit.
import { ConnectButton } from '@rainbow-me/rainbowkit';

export const WalletButton = () => (
  <ConnectButton
    showBalance={false}
    chainStatus="none"
    accountStatus={{ smallScreen: 'avatar', largeScreen: 'address' }}
  />
);
