import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BlobsServer } from '@netlify/blobs/server';
import { apiSuite } from './api-suite.mjs';

/* The API on Netlify Blobs (a local, filesystem-backed Blobs server). */
let dir, server;
apiSuite('Netlify Blobs', {
  async start() {
    dir = await mkdtemp(join(tmpdir(), 'exotic-blobs-'));
    server = new BlobsServer({ directory: dir, token: 'test-token' });
    const { port } = await server.start();
    const edge = `http://127.0.0.1:${port}`;
    process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: edge, uncachedEdgeURL: edge, token: 'test-token', siteID: 'test' })).toString('base64');
  },
  async stop() {
    await server?.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
