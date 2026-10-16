import { tables, type DbConnection } from "../../module_bindings";
import { reducerErrorMessage } from "./reducer-errors";
import { withRequestDeadline } from "./request-deadline";

export type BuyShopCardResult = { ok: boolean; error?: string };

type Target = { connection: DbConnection; isCurrent: () => boolean };
const NONE: readonly string[] = Object.freeze([]);

/** The cards this account bought from the Card Seller, by rotation, from my_card_shop_purchases; and buy_shop_card. */
export function createCardShopRows(notify: () => void) {
  let target: Target | null = null;
  let bought = new Map<number, readonly string[]>();

  function watch(connection: DbConnection, isCurrent: () => boolean) {
    target = { connection, isCurrent };
    bought = new Map();
    const read = () => {
      if (!isCurrent()) return;
      const next = new Map<number, readonly string[]>();
      for (const row of connection.db.myCardShopPurchases.iter()) next.set(Number(row.rotation), [...row.cardIds]);
      bought = next;
      notify();
    };
    const view = connection.db.myCardShopPurchases;
    view.onInsert(read); view.onUpdate(read); view.onDelete(read);
    connection.subscriptionBuilder().onApplied(read).subscribe([tables.myCardShopPurchases]);
  }

  return {
    watch,
    api: {
      /** The card ids bought in one rotation. */
      cardShopBought: (rotation: number): readonly string[] => bought.get(rotation) ?? NONE,
      async buyShopCard(rotation: number, cardId: string): Promise<BuyShopCardResult> {
        const current = target;
        if (!current || !current.isCurrent() || !current.connection.isActive) return { ok: false, error: "NOT CONNECTED" };
        try {
          // A card can be bought once a rotation, so a retry after a dropped reply cannot buy it twice.
          await withRequestDeadline(current.connection.reducers.buyShopCard({ rotation: BigInt(rotation), cardId }));
          return { ok: true };
        } catch (error) {
          return { ok: false, error: reducerErrorMessage(error) };
        }
      },
    },
  };
}
