import { tables, type DbConnection } from "../../module_bindings";
import { MAX_CARD_SLOTS, OWNED_GEAR_SLOTS, cardDefinition } from "../../../shared/cards";
import { reducerErrorMessage } from "./reducer-errors";
import { withRequestDeadline } from "./request-deadline";

export type GearSlots = { slots: number; cards: readonly string[] };
export type CardDrop = { cardIds: readonly string[]; sequence: bigint };
export type SlotCardResult = { ok: boolean; error?: string };

type Target = { connection: DbConnection; isCurrent: () => boolean };
const copyKey = (itemId: string, copyId: bigint) => `${itemId}:${copyId}`;
const OWNED_GEAR: GearSlots = Object.freeze({ slots: OWNED_GEAR_SLOTS, cards: Object.freeze([]) as readonly string[] });

const gearSlotsOf = (row: { slots: number; cards: readonly string[] }): GearSlots => {
  const slots = Math.max(0, Math.min(MAX_CARD_SLOTS, Math.floor(row.slots)));
  return { slots, cards: row.cards.filter(cardId => cardDefinition(cardId)).slice(0, slots) };
};

/** This account's cards, each copy's slots, and new card finds, from the my_* card views; and slot_card. */
export function createCardRows(notify: () => void) {
  let target: Target | null = null;
  let counts: Record<string, number> = {};
  let slots = new Map<string, GearSlots>();
  let drop: CardDrop | null = null;
  let dropListener: ((drop: CardDrop) => void) | null = null;

  function watch(connection: DbConnection, isCurrent: () => boolean) {
    target = { connection, isCurrent };
    counts = {};
    slots = new Map();
    drop = null;
    // The standing row on connect is an old find, not one to announce.
    let hydrated = false;
    const readCards = () => {
      if (!isCurrent()) return;
      const next: Record<string, number> = {};
      for (const row of connection.db.myCards.iter()) if (cardDefinition(row.cardId) && row.count > 0) next[row.cardId] = row.count;
      counts = next;
      notify();
    };
    const readSlots = () => {
      if (!isCurrent()) return;
      const next = new Map<string, GearSlots>();
      for (const row of connection.db.myGearSlots.iter()) next.set(copyKey(row.itemId, 0n), gearSlotsOf(row));
      for (const row of connection.db.myCopySlots.iter()) next.set(copyKey(row.itemId, row.copyId), gearSlotsOf(row));
      slots = next;
      notify();
    };
    const readDrop = () => {
      if (!isCurrent()) return;
      const [row] = [...connection.db.myCardDrop.iter()];
      const previous = drop;
      drop = row ? { cardIds: row.cardIds.filter(cardId => cardDefinition(cardId)), sequence: row.sequence } : null;
      notify();
      if (hydrated && drop && drop.sequence !== previous?.sequence && drop.cardIds.length) dropListener?.(drop);
    };
    connection.db.myCards.onInsert(readCards); connection.db.myCards.onUpdate(readCards); connection.db.myCards.onDelete(readCards);
    for (const view of [connection.db.myGearSlots, connection.db.myCopySlots]) {
      view.onInsert(readSlots); view.onUpdate(readSlots); view.onDelete(readSlots);
    }
    connection.db.myCardDrop.onInsert(readDrop); connection.db.myCardDrop.onUpdate(readDrop); connection.db.myCardDrop.onDelete(readDrop);
    connection.subscriptionBuilder()
      .onApplied(() => { readCards(); readSlots(); readDrop(); hydrated = true; })
      .subscribe([tables.myCards, tables.myGearSlots, tables.myCopySlots, tables.myCardDrop]);
  }

  return {
    watch,
    api: {
      /** Cards held, by card id; a card not held is missing. */
      cards: (): Readonly<Record<string, number>> => counts,
      /** One copy's slots and cards; copy id 0 is the first copy. No row is one empty slot. */
      gearSlots: (itemId: string, copyId = 0n): GearSlots => slots.get(copyKey(itemId, copyId)) ?? OWNED_GEAR,
      /** The cards in an item's first copy, the one an equipment slot holds. */
      itemCards: (itemId: string): readonly string[] => slots.get(copyKey(itemId, 0n))?.cards ?? OWNED_GEAR.cards,
      /** Called with each new find, not with the standing row on connect. */
      setOnCardDrop(callback: ((drop: CardDrop) => void) | null) { dropListener = callback; },
      /** `expectedCards` is how many cards the player saw in the item, so a double tap cannot spend two. */
      async slotCard(itemId: string, copyId: bigint, cardId: string, expectedCards: number): Promise<SlotCardResult> {
        const current = target;
        if (!current || !current.isCurrent() || !current.connection.isActive) return { ok: false, error: "NOT CONNECTED" };
        try {
          // expectedCards makes a retry safe if the connection drops after the server commits.
          await withRequestDeadline(current.connection.reducers.slotCard({ itemId, copyId, cardId, expectedCards }));
          return { ok: true };
        } catch (error) {
          return { ok: false, error: reducerErrorMessage(error) };
        }
      },
    },
  };
}
