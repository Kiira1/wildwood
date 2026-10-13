import type { DbConnection } from "../module_bindings";

export type ReducerPort = {
  connection: () => DbConnection | null;
  protocolBlocked: () => boolean;
  /** False until this connection has registered its session; the server rejects session-bound calls before then. */
  protocolReady?: () => boolean;
  worldEntryBlocked: () => boolean;
  runWorldReducer: <T>(reducer: () => T | PromiseLike<T>) => Promise<T>;
  sendReducer: (
    action: string,
    reducer: (connection: DbConnection) => unknown,
    onRejected?: () => void,
    onAccepted?: () => void,
  ) => void;
  errorMessage: (error: unknown) => string;
  handleFailure: (action: string, error: unknown) => void;
};

export type ChangePort = {
  notify: () => void;
  batch: (action: () => void) => void;
};
