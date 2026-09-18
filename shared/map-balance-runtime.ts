import type { MapBalanceSnapshot } from './map-balance-types';
// Browser-only installation. Server calculations pass their database snapshot explicitly.
// This module has no database or browser dependencies and is empty on the server.
let active: MapBalanceSnapshot | null = null;
export function installMapBalance(snapshot: MapBalanceSnapshot | null) { active = snapshot; }
export function runtimeMapBalance(mapId: string) { return active?.mapId === mapId ? active : null; }
