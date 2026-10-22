// A small typed client for the Gaia server API. The types come from `packages/core` (api.ts).
import type { AuctionResponse } from '@gaia/core';

/** The server answered with a status that is not 2xx. */
export class ApiError extends Error {
  constructor(
    readonly path: string,
    readonly status: number,
    /** The JSON body of the answer, or its text when it is not JSON. */
    readonly body: unknown,
  ) {
    super(`GET ${path} failed with HTTP ${status}${errorText(body)}`);
    this.name = 'ApiError';
  }
}

/** The server sends `{ error: string }` with each error status. */
const errorText = (body: unknown) => {
  if (typeof body === 'object' && body !== undefined && body !== null && 'error' in body) {
    return `: ${String(body.error)}`;
  }
  return '';
};

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export interface ApiClient {
  getAuction: () => Promise<AuctionResponse>;
}

/**
 * Makes a client for the server at `baseUrl` (for example `/api` or `https://api.example.com`).
 * A network error rejects with the error of `fetch`.
 */
export const createApiClient = (
  baseUrl: string,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): ApiClient => {
  const root = baseUrl.replace(/\/+$/, '');

  const getJson = async <T>(path: string): Promise<T> => {
    const response = await fetchFn(`${root}${path}`, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new ApiError(path, response.status, await readBody(response));
    }
    return (await response.json()) as T;
  };

  return {
    getAuction: () => getJson<AuctionResponse>('/auction'),
  };
};
