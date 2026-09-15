import { App } from "@capacitor/app";
import { KeepAwake } from "@capacitor-community/keep-awake";
import { SCREEN_ACTIVITY_EVENT, type NativeScreenWakeLock } from "../../src/app/screen-wake-lock";

export function installNativeKeepScreenOn() {
  const bridge: NativeScreenWakeLock = {
    active: !document.hidden,
    async request() {
      await KeepAwake.keepAwake();
      return { release: () => KeepAwake.allowSleep() };
    },
  };
  (window as Window & { wildstatScreenWakeLock?: NativeScreenWakeLock }).wildstatScreenWakeLock = bridge;
  const update = ({ isActive }: { isActive: boolean }) => {
    bridge.active = isActive;
    window.dispatchEvent(new Event(SCREEN_ACTIVITY_EVENT));
  };
  void App.addListener("appStateChange", update).catch(() => {});
}
