import { tables, type DbConnection } from "../../module_bindings";
import { BUILD_SLOTS, parseBuildCards, parseBuildGear, type SavedBuild } from "../../../shared/builds";
import { reducerErrorMessage } from "./reducer-errors";
import { withRequestDeadline } from "./request-deadline";

type Result = { ok: boolean; error?: string };
type Target = { connection: DbConnection; isCurrent: () => boolean };

/** This account's saved Builds, from the my_builds view, and the save_build and apply_build_cards calls. */
export function createBuildRows(notify: () => void) {
  let target: Target | null = null;
  let builds: (SavedBuild | null)[] = Array.from({ length: BUILD_SLOTS }, () => null);

  function watch(connection: DbConnection, isCurrent: () => boolean) {
    target = { connection, isCurrent };
    builds = Array.from({ length: BUILD_SLOTS }, () => null);
    const read = () => {
      if (!isCurrent()) return;
      const next: (SavedBuild | null)[] = Array.from({ length: BUILD_SLOTS }, () => null);
      for (const row of connection.db.myBuilds.iter()) {
        if (row.slot < BUILD_SLOTS) next[row.slot] = { slot: row.slot, gear: parseBuildGear(row.gearJson), cards: parseBuildCards(row.cardsJson) };
      }
      builds = next;
      notify();
    };
    connection.db.myBuilds.onInsert(read); connection.db.myBuilds.onUpdate(read); connection.db.myBuilds.onDelete(read);
    connection.subscriptionBuilder().onApplied(read).subscribe([tables.myBuilds]);
  }

  async function call(send: (connection: DbConnection) => Promise<unknown>): Promise<Result> {
    const current = target;
    if (!current?.isCurrent() || !current.connection.isActive) return { ok: false, error: "NOT CONNECTED" };
    try {
      await withRequestDeadline(send(current.connection));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: reducerErrorMessage(error) };
    }
  }

  return {
    watch,
    api: {
      builds: (): readonly (SavedBuild | null)[] => builds,
      saveBuild: (slot: number) => call(connection => connection.reducers.saveBuild({ slot })),
      applyBuildCards: (slot: number) => call(connection => connection.reducers.applyBuildCards({ slot })),
    },
  };
}
