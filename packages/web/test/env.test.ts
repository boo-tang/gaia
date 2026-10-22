import { describe, expect, it } from 'vitest';

import { chainForDeployment } from '../src/config/chain';
import { parseWebEnv } from '../src/config/env';

const anvil = chainForDeployment(31337);
const baseSepolia = chainForDeployment(84532);

describe('parseWebEnv', () => {
  it('has defaults for Anvil', () => {
    expect(parseWebEnv({}, anvil)).toEqual({
      apiUrl: '/api',
      rpcUrl: 'http://127.0.0.1:8545',
      walletConnectProjectId: undefined,
    });
  });

  it('reads empty values as not set', () => {
    const env = { VITE_API_URL: '', VITE_RPC_URL: ' ', VITE_WALLETCONNECT_PROJECT_ID: '' };
    expect(parseWebEnv(env, anvil)).toEqual(parseWebEnv({}, anvil));
  });

  it('reads all values and removes the last / of the API URL', () => {
    const env = {
      VITE_API_URL: 'https://api.example.com/',
      VITE_RPC_URL: 'https://sepolia.base.org',
      VITE_WALLETCONNECT_PROJECT_ID: 'abc123',
    };
    expect(parseWebEnv(env, baseSepolia)).toEqual({
      apiUrl: 'https://api.example.com',
      rpcUrl: 'https://sepolia.base.org',
      walletConnectProjectId: 'abc123',
    });
  });

  it('needs VITE_RPC_URL for Base Sepolia', () => {
    expect(() => parseWebEnv({}, baseSepolia)).toThrow(/VITE_RPC_URL: must be set for Base Sepolia \(chain ID 84532\)/);
  });

  it('names a wrong variable', () => {
    expect(() => parseWebEnv({ VITE_RPC_URL: 'not a url' }, anvil)).toThrow(/VITE_RPC_URL/);
  });
});
