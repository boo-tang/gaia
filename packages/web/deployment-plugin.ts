// The Vite plugin that gives the deployment file to the app as the module
// `virtual:gaia-deployment`. It reads and checks the file when Vite starts, so a missing or wrong
// file stops `dev` and `build` with a clear message.
//
// This file imports `@gaia/core`, which is TypeScript source. Node cannot load it, so the package
// scripts run Vite and Vitest with `--configLoader runner`.
import { type Deployment, parseDeployment } from '@gaia/core';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export const DEPLOYMENT_MODULE = 'virtual:gaia-deployment';
const RESOLVED_DEPLOYMENT_MODULE = `\0${DEPLOYMENT_MODULE}`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The deployment file of `DEPLOYMENT_FILE`. A relative path starts at the repository root. */
export const resolveDeploymentFile = (value: string | undefined) =>
  path.resolve(REPO_ROOT, value === undefined || value === '' ? 'deployments/local.json' : value);

/** Reads and checks a deployment file. Throws an error that names the file and the problem. */
export const loadDeploymentFile = (file: string): Deployment => {
  if (!fs.existsSync(file)) {
    throw new Error(
      `Deployment file not found: ${file}\n` +
        'Run `yarn deploy:local` for the local node, or set DEPLOYMENT_FILE to a deployment file.',
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Deployment file is not valid JSON: ${file}\n  ${(error as Error).message}`);
  }
  try {
    return parseDeployment(json);
  } catch (error) {
    throw new Error(`${(error as Error).message}\n  (file: ${file})`);
  }
};

export const deploymentPlugin = (file: string): Plugin => ({
  name: 'gaia-deployment',
  buildStart() {
    loadDeploymentFile(file);
    this.addWatchFile(file);
  },
  resolveId(id) {
    if (id === DEPLOYMENT_MODULE) {
      return RESOLVED_DEPLOYMENT_MODULE;
    }
    return undefined;
  },
  load(id) {
    if (id === RESOLVED_DEPLOYMENT_MODULE) {
      return `export default ${JSON.stringify(loadDeploymentFile(file))};`;
    }
    return undefined;
  },
});
