import { tables, type DbConnection } from "../../module_bindings";

/** This account's gold (my_gold); no row means none. */
export function createGoldRows(notify: () => void) {
  let gold = 0n;

  function watch(connection: DbConnection, isCurrent: () => boolean) {
    gold = 0n;
    const read = () => {
      if (!isCurrent()) return;
      let next = 0n;
      for (const row of connection.db.myGold.iter()) next = row.gold;
      if (next === gold) return;
      gold = next;
      notify();
    };
    connection.db.myGold.onInsert(read); connection.db.myGold.onUpdate(read); connection.db.myGold.onDelete(read);
    connection.subscriptionBuilder().onApplied(read).subscribe([tables.myGold]);
  }

  return {
    watch,
    api: {
      gold: (): bigint => gold,
    },
  };
}
