import { createHash, sign, verify } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = fileURLToPath(new URL('../../..', import.meta.url));
export const mobile = resolve(root, 'mobile');
export const stateDir = resolve(root, 'local-data/ota');
export const json = async path => JSON.parse(await readFile(path, 'utf8'));
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export async function writeJson(path, data) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path + '.tmp', JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(path + '.tmp', path);
}
export async function compatibility() {
  const ota = await readFile(resolve(root, 'shared/ota-update.ts'), 'utf8');
  const rules = await readFile(resolve(root, 'shared/rules.ts'), 'utf8');
  const version = await json(resolve(mobile, 'www/version.json'));
  const files = [];
  async function collect(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (['assets', 'public', 'build', '.gradle', '.DS_Store', 'xcuserdata', 'Assets.xcassets', 'capacitor.config.json', 'config.xml'].includes(entry.name)) continue;
      const next = resolve(path, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Native fingerprint does not follow symlinks.');
      if (entry.isDirectory()) await collect(next); else files.push(next);
    }
  }
  for (const path of ['mobile/android/app/src/main', 'mobile/ios/App/App']) await collect(resolve(root, path));
  for (const path of ['mobile/package-lock.json', 'mobile/capacitor.config.json', 'mobile/android/app/build.gradle', 'mobile/android/build.gradle', 'mobile/android/variables.gradle', 'mobile/android/gradle/wrapper/gradle-wrapper.properties', 'mobile/ios/App/CapApp-SPM/Package.swift', 'mobile/ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved', 'mobile/ios/App/App.xcodeproj/project.pbxproj']) files.push(resolve(root, path));
  const hash = createHash('sha256');
  for (const file of files.sort()) { hash.update(relative(root, file)); hash.update(await readFile(file)); }
  const runtime = ota.match(/OTA_RUNTIME = '([^']+)'/)?.[1];
  const saveFormat = Number(ota.match(/OTA_SAVE_FORMAT = (\d+)/)?.[1]);
  const protocol = Number(rules.match(/PROTOCOL_VERSION = (\d+)/)?.[1]);
  if (!runtime || !saveFormat || !protocol) throw new Error('Missing OTA compatibility constants.');
  return { runtime, saveFormat, protocol, nativeFingerprint: hash.digest('hex'), version: version.version };
}
export function assertCompatible(a, b) {
  for (const key of ['runtime', 'saveFormat', 'protocol', 'nativeFingerprint']) if (a[key] !== b[key]) throw new Error(`${key} changed; create a new native app release first.`);
}
export async function signed(payload) {
  const privateKey = await readFile(resolve(stateDir, 'signing-private.pem'));
  const publicKey = (await json(resolve(mobile, 'ota/public-key.json'))).pem;
  const signature = sign('sha256', Buffer.from(payload), privateKey).toString('base64');
  if (!verify('sha256', Buffer.from(payload), publicKey, Buffer.from(signature, 'base64'))) throw new Error('Signing key does not match installed public key.');
  return { payload, signature };
}
export async function readSigned(path) {
  const envelope = await json(path);
  const publicKey = (await json(resolve(mobile, 'ota/public-key.json'))).pem;
  if (!verify('sha256', Buffer.from(envelope.payload), publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('Invalid announcement signature.');
  return JSON.parse(envelope.payload);
}
