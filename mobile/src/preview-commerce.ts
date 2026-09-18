import { installNativeUpdates } from './ota-updates';
import { installNativeKeepScreenOn } from "./keep-screen-on";
import { Browser } from "@capacitor/browser";
import { installAndroidUpdates } from './android-updates';
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { installResearchNotifications } from './research-notifications';
import { installNativeAuth } from './native-auth';
import { Capacitor } from '@capacitor/core';
import { createTestAds } from './test-ads';
import { optionalTestPurchases } from './test-purchases';
import type { NativeTestPurchases } from '../../src/app/native-purchases';
import type { WildstatNativeBridge } from '../../src/app/native-ads';

declare const __TEST_PURCHASE_CONFIG__: unknown;
const platform = Capacitor.getPlatform();
if (platform === 'ios' || platform === 'android') {
  (window as unknown as { wildstatOpenPatreon: (url: string) => Promise<void> }).wildstatOpenPatreon = async raw => {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "www.patreon.com" || !["/oauth2/authorize", "/c/wildstat/membership"].includes(url.pathname)) throw new Error("Invalid Patreon link");
    await Browser.open({ url: raw });
  };
  (window as unknown as { wildstatOpenCommunity: (url: string) => Promise<void> }).wildstatOpenCommunity = async raw => {
    if (!["https://discord.gg/mcS226NbG4", "https://www.patreon.com/c/wildstat/membership"].includes(raw)) throw new Error("Invalid community link");
    await Browser.open({ url: raw });
  };
  window.addEventListener("wildstat:toolbar-haptic", () => {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  });
  installNativeUpdates(platform);
  installNativeKeepScreenOn();
  installNativeAuth();
  if (platform === 'android') installAndroidUpdates();
  installResearchNotifications(platform);
  const testPurchases = optionalTestPurchases(__TEST_PURCHASE_CONFIG__);
  if (testPurchases) (window as unknown as { wildstatTestPurchases: NativeTestPurchases }).wildstatTestPurchases = testPurchases;
  const runtime = window as unknown as { wildstatNative: WildstatNativeBridge };
  runtime.wildstatNative = { platform, rewardedAds: createTestAds(platform) };
  window.dispatchEvent(new Event('wildstat:native-rewarded-ads-changed'));
}
