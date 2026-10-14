type UnreadMessage = { id: bigint; sender: string; sentAtMs: number };
export type ChatUnreadCounts = { world: number; guild: number; private: number; conversations: Map<string, number> };

export function formatChatUnreadCount(count: number) {
  return count > 99 ? "+99" : count > 0 ? String(count) : "";
}

/** Hydrated history is quiet; per-channel cursors survive the rolling live-message window. */
export function createChatUnreadTracker(startedAtMs = Date.now()) {
  let initialized = false;
  let hydrateGuild = false;
  const channels = new Map<string, { latestId: bigint; count: number }>();
  return {
    reset(now = Date.now()) {
      startedAtMs = now;
      initialized = false;
      hydrateGuild = false;
      channels.clear();
    },
    resetGuild() {
      channels.delete("guild");
      hydrateGuild = true;
    },
    refresh(localIdentity: string, guild: UnreadMessage[], conversations: Map<string, UnreadMessage[]>, readConversation: string | null, world: UnreadMessage[] = []): ChatUnreadCounts {
      const collect = (key: string, rows: UnreadMessage[]) => {
        const state = channels.get(key) ?? { latestId: 0n, count: 0 };
        let latestId = state.latestId;
        for (const row of rows) {
          if (initialized && !(key === "guild" && hydrateGuild) && row.id > state.latestId && row.sender !== localIdentity && row.sentAtMs >= startedAtMs) state.count++;
          if (row.id > latestId) latestId = row.id;
        }
        state.latestId = latestId;
        if (readConversation === key) state.count = 0;
        channels.set(key, state);
      };
      collect("world", world);
      collect("guild", guild);
      hydrateGuild = false;
      for (const [identity, rows] of conversations) collect(`private:${identity}`, rows);
      initialized = true;
      const counts: ChatUnreadCounts = { world: channels.get("world")?.count ?? 0, guild: channels.get("guild")?.count ?? 0, private: 0, conversations: new Map() };
      // Only listed conversations count: one that left the list (an expired duel result, a blocked player)
      // can no longer be opened to clear it. Its cursor is kept, so a reconnect does not count it again.
      for (const identity of conversations.keys()) {
        const count = channels.get(`private:${identity}`)?.count ?? 0;
        counts.private += count;
        if (count) counts.conversations.set(identity, count);
      }
      return counts;
    },
  };
}
