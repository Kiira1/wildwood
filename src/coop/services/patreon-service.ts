import { Identity } from "spacetimedb";
import type { ReducerPort } from "../ports";
import { configureAvatarFrames, updateAvatarFrame } from "../../app/avatar-frames";
import type { AvatarFrame, AvatarFrameState, PatreonStatus } from "../../../shared/avatar-frames";

export function createPatreonService(reducers: ReducerPort, localIdentity: () => string) {
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let autoIdentity = "";
  configureAvatarFrames(async identities => {
    const connection = reducers.connection();
    if (!connection?.isActive) throw new Error("Not connected");
    return JSON.parse(await connection.procedures.getAvatarFrames({ identities: identities.map(id => Identity.fromString(id)) })) as AvatarFrameState[];
  });
  function connection() {
    const active = reducers.connection();
    if (!active?.isActive || reducers.protocolBlocked()) throw new Error("Connect to the latest WildStat version first.");
    return active;
  }
  async function status(refresh: boolean) {
    const active = connection(), identity = localIdentity();
    const result = JSON.parse(await (refresh ? active.procedures.refreshPatreonMembership({}) : active.procedures.getPatreonStatus({}))) as PatreonStatus;
    if (active !== reducers.connection() || identity !== localIdentity()) throw new Error("Account changed. Open your profile again.");
    updateAvatarFrame({ identity, ...result });
    if (result.linked && !refreshTimer) refreshTimer = setInterval(() => { if (reducers.connection()?.isActive) void status(true).catch(() => {}); }, 30 * 60_000);
    if (!result.linked) { clearInterval(refreshTimer); refreshTimer = undefined; }
    return result;
  }
  async function change(action: (active: ReturnType<typeof connection>) => Promise<unknown>) {
    const active = connection(), identity = localIdentity();
    await action(active);
    if (active !== reducers.connection() || identity !== localIdentity()) throw new Error("Account changed. Open your profile again.");
    return status(false);
  }
  const api = {
    patreonStatus: () => status(false), refreshPatreon: () => status(true),
    beginPatreonLink: () => {
      const state = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
      return connection().procedures.beginPatreonLink({ state });
    },
    setAvatarFrame: (frame: AvatarFrame) => change(active => active.reducers.setAvatarFrame({ frame })),
    disconnectPatreon: () => change(active => active.reducers.disconnectPatreon({})),
  };
  return { api,
    sync() {
      if (!localIdentity() || autoIdentity === localIdentity()) return;
      autoIdentity = localIdentity();
      void status(true).catch(() => {});
    },
    clear() { autoIdentity = ""; clearInterval(refreshTimer); refreshTimer = undefined; },
  };
}
