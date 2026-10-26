import { expect, it } from 'vitest';
import { createDpsMeter } from './dps-meter';

it('resets breakdown independently of the HUD DPS and accepts new hits immediately', () => {
  let now = 0;
  const meter = createDpsMeter(() => now);
  meter.record(100, 'staff-direct');
  now = 1000;
  meter.record(50, 'staff-splash');
  const hud = meter.perSecond();
  meter.resetBreakdown();
  expect(meter.breakdown()).toEqual([]);
  expect(meter.perSecond()).toBe(hud);
  meter.record(30, 'staff-chain');
  expect(meter.breakdown()).toEqual([{ source: 'staff-chain', perSecond: 30 }]);
});
