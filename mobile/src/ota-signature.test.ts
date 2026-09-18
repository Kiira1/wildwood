import { generateKeyPairSync, sign } from 'node:crypto';
import { it, expect } from 'vitest';
import { verifyOtaEnvelope } from './ota-signature';
it('verifies real RSA signatures and rejects changed payloads or a different signing key', async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const payload = JSON.stringify({ channel: 'developer', sequence: 1 });
  const signature = sign('sha256', Buffer.from(payload), keys.privateKey).toString('base64');
  expect(await verifyOtaEnvelope({ payload, signature }, keys.publicKey)).toEqual({ channel: 'developer', sequence: 1 });
  await expect(verifyOtaEnvelope({ payload: payload.replace('developer', 'production'), signature }, keys.publicKey)).rejects.toThrow('signature');
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await expect(verifyOtaEnvelope({ payload, signature: sign('sha256', Buffer.from(payload), other.privateKey).toString('base64') }, keys.publicKey)).rejects.toThrow('signature');
});
