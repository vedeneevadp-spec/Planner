package ru.chaotika.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PlannerAuthStorage")
public class PlannerAuthStoragePlugin extends Plugin {

    private static final String PREFERENCES_GROUP = "CapacitorStorage";

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");

        if (key == null || value == null) {
            call.reject("Auth storage key and value are required.");
            return;
        }

        // Auth rotation must not reach the server before the operation marker
        // is on disk. SharedPreferences.apply() cannot provide that guarantee.
        boolean committed = getPreferences().edit().putString(key, value).commit();

        if (!committed) {
            call.reject("Failed to commit auth storage.");
            return;
        }

        call.resolve();
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");

        if (key == null) {
            call.reject("Auth storage key is required.");
            return;
        }

        boolean committed = getPreferences().edit().remove(key).commit();

        if (!committed) {
            call.reject("Failed to commit auth storage removal.");
            return;
        }

        call.resolve();
    }

    private SharedPreferences getPreferences() {
        return getContext().getSharedPreferences(PREFERENCES_GROUP, Context.MODE_PRIVATE);
    }
}
