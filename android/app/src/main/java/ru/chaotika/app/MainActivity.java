package ru.chaotika.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlannerWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        PlannerWidgetStorage.storePendingRouteFromIntent(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        PlannerWidgetStorage.storePendingRouteFromIntent(this, intent);
        super.onNewIntent(intent);
        setIntent(intent);
    }
}
