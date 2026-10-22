// The configuration of this build: the deployment, its chain and the env values.
import { parseDeployment } from '@gaia/core';

import deploymentJson from 'virtual:gaia-deployment';

import { chainForDeployment } from './chain';
import { parseWebEnv } from './env';

export const deployment = parseDeployment(deploymentJson);
export const gaiaChain = chainForDeployment(deployment.chainId);
export const webConfig = parseWebEnv(import.meta.env, gaiaChain);
