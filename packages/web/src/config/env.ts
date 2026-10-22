// The browser configuration, from the `VITE_*` variables. See `.env.example`.
import { z } from 'zod';

import type { GaiaChain } from './chain';

/** An empty value in an env file is the same as no value. */
const emptyToUndefined = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

const webEnvSchema = z.object({
  VITE_API_URL: z.preprocess(emptyToUndefined, z.string().trim().default('/api')),
  VITE_RPC_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  VITE_WALLETCONNECT_PROJECT_ID: z.preprocess(emptyToUndefined, z.string().trim().optional()),
});

export interface WebConfig {
  /** The API base URL, with no `/` at the end. */
  apiUrl: string;
  rpcUrl: string;
  /** Not there: the app has no WalletConnect wallets. */
  walletConnectProjectId?: string;
}

/** Reads the configuration. Throws an error that names each wrong variable. */
export const parseWebEnv = (env: Record<string, unknown>, gaiaChain: GaiaChain): WebConfig => {
  const result = webEnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid web app configuration:\n  ${problems.join('\n  ')}`);
  }
  const rpcUrl = result.data.VITE_RPC_URL ?? gaiaChain.defaultRpcUrl;
  if (rpcUrl === undefined) {
    throw new Error(
      `Invalid web app configuration:\n  VITE_RPC_URL: must be set for ${gaiaChain.chain.name} (chain ID ${gaiaChain.chain.id})`,
    );
  }
  return {
    apiUrl: result.data.VITE_API_URL.replace(/\/+$/, ''),
    rpcUrl,
    walletConnectProjectId: result.data.VITE_WALLETCONNECT_PROJECT_ID,
  };
};
