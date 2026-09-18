import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, mobile, stateDir, json, writeJson, digest, compatibility, assertCompatible, signed, readSigned } from './common.mjs';
const [command, ...args] = process.argv.slice(2);
const flag = name => { const i = args.indexOf(`--${name}`); if (i < 0 || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing --${name}`); return args[i + 1]; };
const platform = () => { const p = flag('platform'); if (!['ios', 'android'].includes(p)) throw new Error('Use ios or android.'); return p; };
const buildNumber = () => { const n = Number(flag('build')); if (!Number.isSafeInteger(n) || n <= 0) throw new Error('Invalid native build number.'); return n; };
const run = (cmd, argv, cwd) => { const r = spawnSync(cmd, argv, { cwd, stdio: 'inherit' }); if (r.status !== 0) throw new Error(`${cmd} failed`); };
const feedPath = (channel, p) => resolve(root, `public/ota/${channel}-${p}.json`);
async function nextSequence(path) { try { return Math.max(Date.now(), (await readSigned(path)).sequence + 1); } catch (e) { if (e.code !== 'ENOENT') throw e; return Date.now(); } }
async function inspectArtifact(path) {
  const meta = await json(resolve(path, 'artifact.json'));
  const bytes = await readFile(resolve(path, 'bundle.zip'));
  const key = (await json(resolve(mobile, 'ota/public-key.json'))).pem;
  if (digest(bytes) !== meta.bundle.checksum || !verify('sha256', bytes, key, Buffer.from(meta.bundle.signature, 'base64'))) throw new Error('Artifact bytes or signature changed. Rebuild it.');
  return meta;
}
async function writeFeed(channel, p, meta, bundle) {
  const path = feedPath(channel, p);
  const manifest = { schema: 1, channel, platform: p, sequence: await nextSequence(path), runtime: meta.runtime, saveFormat: meta.saveFormat, protocol: meta.protocol, minBuild: meta.build, maxBuild: meta.build, bundle };
  const envelope = await signed(JSON.stringify(manifest));
  await writeJson(path, envelope);
  await writeJson(resolve(stateDir, 'history', `${manifest.sequence}-${channel}-${p}.json`), envelope);
  console.log(`Prepared ${channel} announcement: ${path}\nPublish this file through the normal web deployment to activate it.`);
}
try {
  if (command === 'keygen') {
    await mkdir(stateDir, { recursive: true });
    const path = resolve(stateDir, 'signing-private.pem');
    try { await stat(path); throw new Error('Signing key already exists. It will not be overwritten.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    try { await stat(resolve(mobile, 'ota/public-key.json')); throw new Error('Public key already exists. Restore its private key; do not silently rotate it.'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const keys = generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    await writeFile(path, keys.privateKey, { mode: 0o600, flag: 'wx' });
    await writeJson(resolve(mobile, 'ota/public-key.json'), { pem: keys.publicKey });
    const configPath = resolve(mobile, 'capacitor.config.json'), config = await json(configPath);
    config.plugins.LiveUpdate = { autoUpdateStrategy: 'none', autoDeleteBundles: true, autoBlockRolledBackBundles: true, readyTimeout: 30000, publicKey: keys.publicKey };
    await writeJson(configPath, config);
    console.log('Created signing key in ignored local-data/ota. Back it up securely; only the public key is shipped.');
  } else if (command === 'baseline') {
    const p = platform(), build = buildNumber(), staged = await json(resolve(mobile, 'www/ota-build.json'));
    assertCompatible(staged, await compatibility());
    if (staged.testPurchasesEnabled) throw new Error('Test-purchase bundles cannot be native baselines.');
    const config = await json(resolve(mobile, 'capacitor.config.json'));
    if (config.plugins?.LiveUpdate?.publicKey !== (await json(resolve(mobile, 'ota/public-key.json'))).pem) throw new Error('Native public key mismatch.');
    const path = resolve(stateDir, 'baselines', `${p}-${build}.json`);
    try { const previous = await json(path); assertCompatible(previous, staged); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    await writeJson(path, { ...staged, platform: p, build });
    console.log(`Recorded ${p} build ${build}. This must describe the native binary you actually distribute.`);
  } else if (command === 'package') {
    const p = platform(), build = buildNumber(), id = flag('id');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(id) || id === 'public') throw new Error('Invalid bundle ID.');
    const baseline = await json(resolve(stateDir, 'baselines', `${p}-${build}.json`));
    const staged = await json(resolve(mobile, 'www/ota-build.json'));
    assertCompatible(staged, await compatibility()); assertCompatible(baseline, staged);
    if (staged.testPurchasesEnabled) throw new Error('Never distribute test-purchase bundles over OTA.');
    const dir = resolve(mobile, '.build/ota', id);
    await mkdir(resolve(mobile, '.build/ota'), { recursive: true });
    await mkdir(dir, { recursive: false }); // Immutable IDs, never overwrite an artifact.
    const archive = resolve(dir, 'bundle.zip');
    run('/usr/bin/zip', ['-q', '-r', archive, '.', '-x', '*.map', '*.DS_Store'], resolve(mobile, 'www'));
    const bytes = await readFile(archive);
    const signature = sign('sha256', bytes, await readFile(resolve(stateDir, 'signing-private.pem'))).toString('base64');
    await writeJson(resolve(dir, 'artifact.json'), { ...staged, platform: p, build, bundle: { id, checksum: digest(bytes), signature } });
    await inspectArtifact(dir);
    console.log(`Signed bundle: ${archive}\nUpload bundle.zip to an HTTPS artifact host, then stage its URL on the developer channel.`);
  } else if (command === 'upload') {
    const artifact = resolve(flag('artifact')), meta = await inspectArtifact(artifact);
    const repo = flag('repo');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Use owner/repository.');
    const result = spawnSync('gh', ['repo', 'view', repo, '--json', 'visibility'], { encoding: 'utf8' });
    if (result.status !== 0 || JSON.parse(result.stdout).visibility !== 'PUBLIC') throw new Error('OTA downloads need a public artifact URL. Use a public repository or your own HTTPS host.');
    const tag = `ota-${meta.bundle.id}`;
    const notes = resolve(artifact, 'release-notes.txt');
    await writeFile(notes, `WildStat developer OTA bundle ${meta.bundle.id}.\nTarget: ${meta.platform} native build ${meta.build}.\nThis artifact is not promoted to players until its signed production announcement is deployed.\n`);
    run('gh', ['release', 'create', tag, resolve(artifact, 'bundle.zip'), resolve(artifact, 'artifact.json'), '--repo', repo, '--title', `WildStat OTA ${meta.bundle.id}`, '--notes-file', notes, '--prerelease'], root);
    console.log(`Uploaded immutable artifact. Stage with:\nnpm --prefix mobile run ota -- stage --artifact ${artifact} --url https://github.com/${repo}/releases/download/${tag}/bundle.zip`);
  } else if (command === 'stage') {
    const artifact = resolve(flag('artifact')), meta = await inspectArtifact(artifact);
    const url = new URL(flag('url'));
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('Use a public HTTPS artifact URL.');
    // Verify uploaded bytes before publishing any announcement. Never trust a local filename alone.
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Artifact download returned ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== meta.bundle.checksum) throw new Error('Hosted artifact differs from signed local bundle.');
    await writeFeed('developer', meta.platform, meta, { ...meta.bundle, url: url.href });
  } else if (command === 'promote') {
    if (!args.includes('--tested-on-device')) throw new Error('Test startup, login, combat, saves, and rollback on device first; then use --tested-on-device.');
    const p = platform(), id = flag('id'), dev = await readSigned(feedPath('developer', p));
    if (!dev.bundle || dev.bundle.id !== id) throw new Error('Only the exact bundle currently on the developer channel can be promoted.');
    await writeFeed('production', p, { ...dev, build: dev.minBuild }, dev.bundle);
  } else if (command === 'rollback') {
    const p = platform(), channel = flag('channel');
    if (!['production', 'developer'].includes(channel)) throw new Error('Unknown channel.');
    if (args.includes('--installed')) {
      const build = buildNumber(), baseline = await json(resolve(stateDir, 'baselines', `${p}-${build}.json`));
      await writeFeed(channel, p, baseline, null);
    } else {
      // Replay a previously signed announcement with a NEW sequence, never downgrade the high-water mark.
      const previous = await readSigned(resolve(flag('announcement')));
      if (previous.platform !== p || previous.channel !== channel) throw new Error('Rollback must stay within the original platform and channel.');
      await writeFeed(channel, p, { ...previous, build: previous.minBuild }, previous.bundle);
    }
  } else {
    console.log('OTA commands: keygen | baseline --platform ios|android --build N | package --platform P --build N --id ID | upload --artifact DIR --repo OWNER/REPO | stage --artifact DIR --url HTTPS | promote --platform P --id ID --tested-on-device | rollback --platform P --channel C (--installed --build N | --announcement FILE)');
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
