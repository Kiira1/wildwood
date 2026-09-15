import { installNativeKeepScreenOn } from "./keep-screen-on";
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
  window.addEventListener("wildstat:toolbar-haptic", () => {
    void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  });
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
