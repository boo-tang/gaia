// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NetworkGuard } from '../src/components/NetworkGuard';

const wallet = vi.hoisted(() => ({
  account: { isConnected: false, chainId: undefined as number | undefined },
  switchChain: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => wallet.account,
  useSwitchChain: () => ({ switchChain: wallet.switchChain, isPending: false, error: null }),
}));

afterEach(() => {
  cleanup();
  wallet.switchChain.mockReset();
});

describe('NetworkGuard', () => {
  it('shows nothing with no wallet or on the deployment chain', () => {
    wallet.account = { isConnected: false, chainId: undefined };
    const { container, rerender } = render(<NetworkGuard />);
    expect(container.textContent).toBe('');
    wallet.account = { isConnected: true, chainId: 31337 };
    rerender(<NetworkGuard />);
    expect(container.textContent).toBe('');
  });

  it('asks the wallet to switch to the deployment chain', () => {
    wallet.account = { isConnected: true, chainId: 84532 };
    render(<NetworkGuard />);
    expect(screen.getByRole('alert').textContent).toContain('Wrong network. Gaia uses Anvil (chain ID 31337).');
    fireEvent.click(screen.getByRole('button', { name: 'Switch network' }));
    expect(wallet.switchChain).toHaveBeenCalledWith({ chainId: 31337 });
  });
});
