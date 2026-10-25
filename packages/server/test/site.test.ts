import { Hono } from 'hono';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createSite } from '../src/api/site';

const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaia-web-'));
fs.mkdirSync(path.join(webDir, 'assets'));
fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>Gaia</title>');
fs.writeFileSync(path.join(webDir, 'assets', 'index-abc123.js'), 'console.log(1);');

const api = new Hono();
api.get('/health', c => c.json({ ok: true }));
const site = createSite(api, webDir);

afterAll(() => fs.rmSync(webDir, { recursive: true, force: true }));

describe('createSite', () => {
  it('serves the API under /api', async () => {
    const response = await site.request('/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect((await site.request('/health')).status).toBe(404);
  });

  it('serves index.html at / without long caching', async () => {
    const response = await site.request('/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<title>Gaia</title>');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('caches the hashed assets for a year', async () => {
    const response = await site.request('/assets/index-abc123.js');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('answers 404 outside the build and does not leave it', async () => {
    expect((await site.request('/nothing-here')).status).toBe(404);
    expect((await site.request('/..%2f..%2fetc%2fpasswd')).status).toBe(404);
  });

  it('sets the security headers on all answers', async () => {
    for (const urlPath of ['/', '/api/health', '/nothing-here']) {
      const response = await site.request(urlPath);
      expect(response.headers.get('X-Content-Type-Options'), urlPath).toBe('nosniff');
      expect(response.headers.get('Referrer-Policy'), urlPath).toBe('no-referrer');
      expect(response.headers.get('X-Frame-Options'), urlPath).toBe('DENY');
    }
  });
});
