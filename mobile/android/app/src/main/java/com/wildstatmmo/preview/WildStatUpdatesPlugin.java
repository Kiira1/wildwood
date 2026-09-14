package com.wildstatmmo.preview;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.install.model.UpdateAvailability;

@CapacitorPlugin(name = "WildStatUpdates")
public class WildStatUpdatesPlugin extends Plugin {
    @PluginMethod
    public void check(PluginCall call) {
        AppUpdateManagerFactory.create(getContext()).getAppUpdateInfo()
            .addOnSuccessListener(info -> {
                try {
                    PackageInfo installed = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
                    JSObject result = new JSObject();
                    result.put("available", info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE);
                    result.put("versionCode", info.availableVersionCode());
                    result.put("installedVersionCode", PackageInfoCompat.getLongVersionCode(installed));
                    call.resolve(result);
                } catch (Exception error) {
                    call.reject("Could not read installed version.", error);
                }
            })
            .addOnFailureListener(error -> call.reject("Google Play update check unavailable.", error));
    }

    @PluginMethod
    public void openStore(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String packageName = getContext().getPackageName();
            try {
                try {
                    getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + packageName))
                        .setPackage("com.android.vending"));
                } catch (ActivityNotFoundException missingStore) {
                    getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + packageName)));
                }
                call.resolve();
            } catch (Exception error) {
                call.reject("Could not open Google Play.", error);
            }
        });
    }
}
