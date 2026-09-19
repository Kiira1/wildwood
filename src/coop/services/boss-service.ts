export function createBossService() {
  const hitResults: { mapId: string; x: number; y: number; damage: number; critical: boolean }[] = [];

  return {
    tables: {
      upsertHitResult(row: { mapId: string; x: number; y: number; damage: number; critical: boolean }) {
        if (hitResults.length >= 100) hitResults.shift();
        hitResults.push({ mapId: row.mapId, x: row.x, y: row.y, damage: row.damage, critical: row.critical });
      },
    },
    api: {
      drainBossHitResults: () => hitResults.splice(0),
    },
    resetSession() {
      hitResults.length = 0;
    },
  };
}
