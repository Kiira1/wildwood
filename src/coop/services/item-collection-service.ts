import { tables, type DbConnection } from "../../module_bindings";

/** Every item this account has had drop, from the my_item_collection view (the map window's Gear Collection). */
export function createItemCollectionRows(notify: () => void) {
  let collected: ReadonlySet<string> = new Set();
  function watch(connection: DbConnection, isCurrent: () => boolean) {
    collected = new Set();
    const read = () => {
      if (!isCurrent()) return;
      collected = new Set([...connection.db.myItemCollection.iter()].map(row => row.itemId));
      notify();
    };
    connection.db.myItemCollection.onInsert(read); connection.db.myItemCollection.onDelete(read);
    connection.subscriptionBuilder().onApplied(read).subscribe([tables.myItemCollection]);
  }
  return { watch, api: { collectedItems: (): ReadonlySet<string> => collected } };
}
