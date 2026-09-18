import mailboxCopy from "./mailbox-copy.json";
export const REBALANCE_MAIL_ID = "stats-explained-2026-09-17";
export const REBALANCE_MAIL_GEMS = 75n;
export const REBALANCE_MAIL_TITLE = mailboxCopy.title;
export const REBALANCE_MAIL_BODY = mailboxCopy.body;

export type MailboxMessage = {
  id: string;
  title: string;
  body: string;
  gems: bigint;
  createdAtMs: number;
  read: boolean;
  claimed: boolean;
};
