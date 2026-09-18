import { test } from 'vitest';
import assert from 'node:assert/strict';
import { assertCompatible, digest } from './common.mjs';
test('native, protocol and save changes require a new native baseline', () => {
  const base = { runtime: 'r', saveFormat: 1, protocol: 106, nativeFingerprint: 'native', version: '0.743' };
  assert.doesNotThrow(() => assertCompatible(base, { ...base, version: '0.744' }));
  for (const key of ['runtime', 'saveFormat', 'protocol', 'nativeFingerprint']) assert.throws(() => assertCompatible(base, { ...base, [key]: 'changed' }), /native app release/);
});
test('artifact digest changes when one byte changes', () => {
  assert.equal(digest(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(digest(Buffer.from('abc')), digest(Buffer.from('abd')));
});
