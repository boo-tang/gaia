// The server entry point: `yarn workspace @gaia/server start`. See README "Server".

import { parseDeployment } from '@gaia/core';
import fs from 'node:fs';

import { loadServerConfig } from './server-config';
import { startServer } from './start-server';

const config = loadServerConfig();
if (!fs.existsSync(config.deploymentFile)) {
  throw new Error(`No deployment file at ${config.deploymentFile}. Run \`yarn deploy:local\`, or set DEPLOYMENT_FILE.`);
}
const deployment = parseDeployment(JSON.parse(fs.readFileSync(config.deploymentFile, 'utf8')));
const server = await startServer(config, deployment);

const stop = async () => {
  await server.close();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
