package com.wildstatmmo.preview;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WildStatUpdatesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
