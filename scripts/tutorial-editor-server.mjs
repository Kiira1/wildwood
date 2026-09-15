import { createServer } from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const copyPath = resolve(root, 'public/assets/wildstat/tutorial-copy.json');
const htmlPath = resolve(root, 'tools/tutorial-editor/index.html');
const port = 4175;
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
let saving = false;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const respond = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (!allowedHosts.has(req.headers.host)) return respond(403, { error: 'Local editor only.' });
  const path = new URL(req.url || '/', `http://${req.headers.host}`).pathname;
  try {
    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(await readFile(htmlPath)); return;
    }
    if (req.method === 'GET' && path === '/copy') return respond(200, JSON.parse(await readFile(copyPath, 'utf8')));
    if (req.method !== 'POST' || path !== '/copy') return respond(404, { error: 'Not found.' });
    if (req.headers.origin !== `http://${req.headers.host}` || !req.headers['content-type']?.startsWith('application/json'))
      return respond(403, { error: 'Save from this editor page.' });
    if (saving) return respond(409, { error: 'A save is already in progress. Try again.' });
    const chunks = []; let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 16_384) return respond(413, { error: 'Text is too long.' });
      chunks.push(chunk);
    }
    let input;
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return respond(400, { error: 'Invalid text data.' }); }
    const current = JSON.parse(await readFile(copyPath, 'utf8'));
    const next = {};
    for (const key of Object.keys(current)) {
      if (typeof input?.[key] !== 'string' || !input[key].trim() || input[key].length > 240)
        return respond(400, { error: 'Every field needs 1–240 characters.' });
      next[key] = input[key].trim();
    }
    if (saving) return respond(409, { error: 'A save is already in progress. Try again.' });
    saving = true;
    try {
      await writeFile(`${copyPath}.tmp`, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      await rename(`${copyPath}.tmp`, copyPath);
    } finally { saving = false; }
    respond(200, { ok: true });
  } catch (error) { console.error(error); if (!res.headersSent) respond(500, { error: 'Could not save. Check the editor terminal.' }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Tutorial text editor: http://127.0.0.1:${port}\nSaves to public/assets/wildstat/tutorial-copy.json`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
