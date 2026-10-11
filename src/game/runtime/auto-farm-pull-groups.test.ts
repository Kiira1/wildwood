import { expect, it } from 'vitest';
import { readAutoFarmPullGroups, writeAutoFarmPullGroups } from './auto-farm-priority';

const memory = () => { const values = new Map<string, string>(); return () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }) as unknown as Storage; };

it("reads nothing switched until a switch is touched, then the groups switched to Aggro, even none", () => {
  const storage = memory();
  expect(readAutoFarmPullGroups(storage)).toBeNull();
  writeAutoFarmPullGroups(['stat:armor', 'soul:damage'], storage);
  expect(readAutoFarmPullGroups(storage)).toEqual(['stat:armor', 'soul:damage']);
  writeAutoFarmPullGroups([], storage);
  expect(readAutoFarmPullGroups(storage)).toEqual([]);
});

it("survives storage that throws or holds junk", () => {
  expect(readAutoFarmPullGroups(() => { throw new Error('blocked'); })).toBeNull();
  const junk = () => ({ getItem: () => '{not json', setItem: () => {} }) as unknown as Storage;
  expect(readAutoFarmPullGroups(junk)).toBeNull();
  expect(() => writeAutoFarmPullGroups(['stat:armor'], () => { throw new Error('blocked'); })).not.toThrow();
});
