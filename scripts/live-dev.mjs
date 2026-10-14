// npm run dev:live: this checkout's client, served on this computer, playing on the live game server
// (wildwood-coop on Maincloud), the same server wildstatmmo.com uses. Same saves, same rules.
// Client edits rebuild and refresh the tab. Server code (spacetimedb/) never changes here: only
// a server publish changes the live server, so its edits do nothing in this mode.
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
import { createLocalDevWork, localChangeKind } from './local-dev-work.mjs';
import { openBrowser } from './open-browser.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const liveHost = 'wss://maincloud.spacetimedb.com';
const liveDatabase = 'wildwood-coop';
const port = Number(process.env.WILDSTAT_LIVE_PORT || 8001);
// Development artifacts stay in memory, independent of release builds. No VITE_LOCAL_TESTING:
// its local-only boosts must never reach the live server.
process.env.NODE_ENV = 'development';
let assets = new Map();
let closing = false;

/** The live server only accepts the client of the version it runs, so warn early when this checkout differs. */
async function warnWhenBehindLive() {
  const local = JSON.parse(await readFile(resolve(root, 'public/version.json'), 'utf8')).version;
  try {
    const response = await fetch('https://wildstatmmo.com/version.json', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const live = (await response.json()).version;
    if (live !== local) {
      console.warn(`\nThis checkout is ${local}; the live game runs ${live}.`);
      console.warn('If the game refuses to connect, run "git pull" (or check out the live version) and start again.\n');
    }
  } catch {
    console.warn('Could not read the live version; continuing.');
  }
}

async function buildClient() {
  console.log('Building the game client…');
  const next = new Map();
  for (const target of ['coop', 'game']) {
    const result = await build({ configFile: resolve(root, `config/vite.${target}.config.ts`), root,
      mode: 'development', publicDir: false, logLevel: 'warn',
      build: { write: false, copyPublicDir: false, emptyOutDir: false, outDir: resolve(root, 'local-data/live-dev-client') },
    });
    for (const bundle of Array.isArray(result) ? result : [result]) {
      for (const file of bundle.output) next.set('/' + file.fileName, file.type === 'chunk' ? file.code : file.source);
    }
  }
  // Swap both bundles together only after both builds succeeded. Keep old hashed
  // worker URLs usable by tabs that are completing their reload.
  for (const [path, content] of assets) if (!next.has(path) && next.size < 128) next.set(path, content);
  assets = next;
}

const server = await createServer({
  configFile: false, root: resolve(root, 'public'), publicDir: false, mode: 'development',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port, strictPort: true, watch: { usePolling: true, interval: 500, binaryInterval: 1500 }, headers: { 'Cache-Control': 'no-store' } },
  plugins: [{
    name: 'wildstat-live-game',
    transformIndexHtml: { order: 'pre', handler: () => [{ tag: 'script', injectTo: 'head-prepend',
      children: `window.WILDWOOD_SPACETIMEDB_HOST = ${JSON.stringify(liveHost)}; window.WILDWOOD_SPACETIMEDB_DB_NAME = ${JSON.stringify(liveDatabase)};`,
    }] },
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        const path = new URL(req.url || '/', 'http://localhost').pathname;
        const content = assets.get(path);
        if (content === undefined) return next();
        res.setHeader('Content-Type', path.endsWith('.map') ? 'application/json' : 'text/javascript');
        res.setHeader('Cache-Control', 'no-store');
        res.end(content);
      });
    },
    handleHotUpdate(context) {
      const kind = localChangeKind(relative(root, context.file).replaceAll('\\', '/'));
      if (kind) return []; // Reload only after our serialized build finishes.
    },
  }],
});
const work = createLocalDevWork({
  async run(changes) {
    if (changes.has('server')) console.log('Server code (spacetimedb/) does not change the live server; shared/ rules change only this client.');
    if (changes.has('client') || changes.has('server')) await buildClient();
    if (closing) return;
    server.ws.send({ type: 'full-reload', path: '*' });
    console.log('Updated. The browser tab refreshes automatically.');
  },
  reportError(error) {
    console.error(error.message);
    console.error('The last successful build stays loaded. Save a correction to retry.');
    server.ws.send({ type: 'error', err: { message: error.message, stack: '', plugin: 'wildstat-live-game' } });
  },
});
async function stop() {
  if (closing) return;
  closing = true;
  const pending = work.close();
  await server.close();
  await pending;
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
try {
  await warnWhenBehindLive();
  await buildClient();
  server.watcher.add(['src', 'shared', 'spacetimedb/src', 'config'].map(path => resolve(root, path)));
  server.watcher.on('all', (event, file) => {
    if (!['add', 'change', 'unlink'].includes(event)) return;
    const path = relative(root, file).replaceAll('\\', '/');
    if (path.startsWith('src/module_bindings/')) return;
    const kind = localChangeKind(path);
    if (kind === 'style') {
      const url = '/' + path.slice('public/'.length);
      server.ws.send({ type: 'update', updates: [{ type: 'css-update', path: url, acceptedPath: url, timestamp: Date.now() }] });
      console.log(`Style updated: ${path}`);
    } else work.add(kind);
  });
  await server.listen();
  console.log(`\nWildStat on the LIVE server: http://127.0.0.1:${port}/\nReal saves and real players. CSS updates live; code rebuilds and refreshes.\nLeave this terminal open; Control-C stops it.\n`);
  if (process.argv.includes('--open')) openBrowser(`http://127.0.0.1:${port}/`);
} catch (error) {
  console.error(error.message);
  await stop();
  process.exitCode = 1;
}
