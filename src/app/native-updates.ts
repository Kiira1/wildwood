export type NativeUpdateState = { channel: 'production' | 'developer'; current: string; pending: string | null; message: string; busy: boolean; developer: boolean };
export type NativeUpdateBridge = {
  check(force?: boolean): Promise<void>; selectChannel(channel: 'production' | 'developer'): Promise<void>;
  rollback(): Promise<void>; setDeveloperAccess(value: boolean): void; snapshot(): NativeUpdateState;
  /** Restarts the app into the downloaded update. */
  applyNow?(): Promise<void>;
};
export function nativeUpdates(): NativeUpdateBridge | undefined {
  return (window as unknown as { wildstatUpdates?: NativeUpdateBridge }).wildstatUpdates;
}
export function signalNativeBootReady() { window.dispatchEvent(new Event('wildstat:boot-ready')); }
