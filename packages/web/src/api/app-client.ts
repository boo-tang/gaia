// The API client of this build (server at `webConfig.apiUrl`).
import { webConfig } from '../config/app-config';
import { createApiClient } from './api-client';

export const apiClient = createApiClient(webConfig.apiUrl);
