export type ModerationHistoryEntry = {
  id: string;
  targetIdentity: string;
  targetName: string;
  channel: string;
  messageId: string;
  action: string;
  reason: string;
  actorType: string;
  actorIdentity: string;
  actorName: string;
  rule: string;
  reportTable: string;
  reportId: string;
  before: string;
  after: string;
  recordedAtMs: number;
};
export type ModerationHistoryPage = { entries: ModerationHistoryEntry[]; beforeId: string; hasMore: boolean };
