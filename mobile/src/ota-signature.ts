import type { SignedOtaManifest } from '../../shared/ota-update';
const decode = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0));
export async function verifyOtaEnvelope(envelope: SignedOtaManifest, pem: string) {
  if (typeof envelope?.payload !== 'string' || envelope.payload.length > 16000 || typeof envelope.signature !== 'string' || envelope.signature.length > 2048) throw new Error('Invalid update announcement.');
  const key = await crypto.subtle.importKey('spki', decode(pem.replace(/-----[^-]+-----|\s/g, '')), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(envelope.signature), new TextEncoder().encode(envelope.payload))) throw new Error('Update signature could not be verified.');
  return JSON.parse(envelope.payload);
}
