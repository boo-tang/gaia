import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { DEPLOYMENT_MODULE, loadDeploymentFile, resolveDeploymentFile } from '../deployment-plugin';

const FIXTURE = resolveDeploymentFile('packages/web/test/fixtures/deployment.json');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-web-'));

afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

const writeTemp = (name: string, text: string) => {
  const file = path.join(tempDir, name);
  fs.writeFileSync(file, text);
  return file;
};

describe('resolveDeploymentFile', () => {
  it('starts a relative path at the repository root', () => {
    expect(resolveDeploymentFile(undefined)).toBe(path.resolve(import.meta.dirname, '../../../deployments/local.json'));
    expect(resolveDeploymentFile('')).toBe(resolveDeploymentFile(undefined));
    expect(resolveDeploymentFile('/tmp/base.json')).toBe('/tmp/base.json');
  });
});

describe('loadDeploymentFile', () => {
  it('loads the fixture', () => {
    const deployment = loadDeploymentFile(FIXTURE);
    expect(deployment.chainId).toBe(31337);
    expect(deployment.contracts.GaiaAuction).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('says how to make a missing file', () => {
    const missing = path.join(tempDir, 'missing.json');
    expect(() => loadDeploymentFile(missing)).toThrow(`Deployment file not found: ${missing}`);
    expect(() => loadDeploymentFile(missing)).toThrow(/yarn deploy:local.*DEPLOYMENT_FILE/s);
  });

  it('names the file when it is not JSON', () => {
    const file = writeTemp('broken.json', '{ "chainId": ');
    expect(() => loadDeploymentFile(file)).toThrow(`Deployment file is not valid JSON: ${file}`);
  });

  it('names the wrong field and the file', () => {
    const json = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const file = writeTemp(
      'wrong.json',
      JSON.stringify({ ...json, contracts: { ...json.contracts, GaiaAuction: '0x12' } }),
    );
    expect(() => loadDeploymentFile(file)).toThrow(/contracts\.GaiaAuction[\s\S]*\(file: .*wrong\.json\)/);
  });
});

describe('the virtual module', () => {
  it('has the fixture in the tests', async () => {
    const { deployment } = await import('../src/config/app-config');
    expect(DEPLOYMENT_MODULE).toBe('virtual:gaia-deployment');
    expect(deployment).toEqual(loadDeploymentFile(FIXTURE));
  });
});
