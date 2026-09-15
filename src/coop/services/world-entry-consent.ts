import type { DbConnection } from '../../module_bindings';

/** Every entry path, including registration and recovery, shares this barrier. */
export async function enterWorldAfterConsent(
  connection: DbConnection, tabId: string,
  syncConsent: (connection: DbConnection) => Promise<boolean>, isCurrent: () => boolean,
) {
  if (!isCurrent()) throw new Error('Session changed. Try again.');
  if (!await syncConsent(connection)) throw new Error('Review and accept the WildStat Terms to continue.');
  if (!isCurrent()) throw new Error('Session changed. Try again.');
  await connection.reducers.enterWorldWithTutorial({ tabId, forceTakeover: false });
}
