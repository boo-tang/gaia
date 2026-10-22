// The server data as TanStack Query hooks.
import { useQuery } from '@tanstack/react-query';

import { webConfig } from '../config/app-config';
import { ApiError, createApiClient } from './api-client';

export const apiClient = createApiClient(webConfig.apiUrl);

/** Tries again up to 3 times after a network or server error. A 4xx answer does not change. */
export const retryServerErrors = (failureCount: number, error: Error) =>
  !(error instanceof ApiError && error.status < 500) && failureCount < 3;

/** The auction rules and status (`GET /auction`). The live stream replaces the polling later. */
export const useAuction = () =>
  useQuery({
    queryKey: ['auction'],
    queryFn: () => apiClient.getAuction(),
    refetchInterval: 30_000,
    retry: retryServerErrors,
  });
