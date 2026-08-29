package ru.chaotika.app;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PlannerAuthStorage")
public class PlannerAuthStoragePlugin extends Plugin {

    private static final String PREFERENCES_GROUP = "CapacitorStorage";

    @PluginMethod
    public void prepareRefresh(PluginCall call) {
        String expectedSessionValue = call.getString("expectedSession");
        PlannerWidgetAuthSession expectedSession = PlannerWidgetAuthSession.parse(
            expectedSessionValue
        );

        if (expectedSession == null) {
            call.reject("A valid expected auth session is required.");
            return;
        }

        try {
            PlannerWidgetAuthSession preparedSession = PlannerWidgetAuthSessionStore.prepareForRefresh(
                getContext(),
                expectedSession
            );

            if (preparedSession == null) {
                call.reject("Failed to prepare secure auth refresh.");
                return;
            }

            resolveSession(call, preparedSession);
        } catch (RuntimeException exception) {
            call.reject("Failed to prepare secure auth refresh.", exception);
        }
    }

    @PluginMethod
    public void commitRefresh(PluginCall call) {
        PlannerWidgetAuthSession attemptedSession = PlannerWidgetAuthSession.parse(
            call.getString("attemptedSession")
        );
        PlannerWidgetAuthSession refreshedSession = PlannerWidgetAuthSession.parse(
            call.getString("refreshedSession")
        );

        if (attemptedSession == null || refreshedSession == null) {
            call.reject("Valid attempted and refreshed auth sessions are required.");
            return;
        }

        try {
            PlannerWidgetAuthSession committedSession = PlannerWidgetAuthSessionStore.commitRefresh(
                getContext(),
                attemptedSession,
                refreshedSession
            );

            if (committedSession == null) {
                call.reject("Failed to commit secure auth refresh.");
                return;
            }

            resolveSession(call, committedSession);
        } catch (RuntimeException exception) {
            call.reject("Failed to commit secure auth refresh.", exception);
        }
    }

    @PluginMethod
    public void get(PluginCall call) {
        String key = call.getString("key");

        if (key == null) {
            call.reject("Auth storage key is required.");
            return;
        }

        try {
            com.getcapacitor.JSObject result = new com.getcapacitor.JSObject();
            String value = PlannerSecureStorage.getString(getContext(), key, PREFERENCES_GROUP);
            result.put("value", value == null ? com.getcapacitor.JSObject.NULL : value);
            call.resolve(result);
        } catch (RuntimeException exception) {
            call.reject("Failed to read secure auth storage.", exception);
        }
    }

    @PluginMethod
    public void set(PluginCall call) {
        String key = call.getString("key");
        String value = call.getString("value");

        if (key == null || value == null) {
            call.reject("Auth storage key and value are required.");
            return;
        }

        try {
            // Auth rotation must not reach the server before the encrypted
            // operation marker is durably committed.
            if (!PlannerSecureStorage.putString(getContext(), key, value, PREFERENCES_GROUP)) {
                call.reject("Failed to commit secure auth storage.");
                return;
            }

            call.resolve();
        } catch (RuntimeException exception) {
            call.reject("Failed to write secure auth storage.", exception);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String key = call.getString("key");

        if (key == null) {
            call.reject("Auth storage key is required.");
            return;
        }

        try {
            if (!PlannerSecureStorage.remove(getContext(), key, PREFERENCES_GROUP)) {
                call.reject("Failed to commit secure auth storage removal.");
                return;
            }

            call.resolve();
        } catch (RuntimeException exception) {
            call.reject("Failed to remove secure auth storage.", exception);
        }
    }

    private static void resolveSession(
        PluginCall call,
        PlannerWidgetAuthSession session
    ) {
        com.getcapacitor.JSObject result = new com.getcapacitor.JSObject();

        result.put("value", session.toJson().toString());
        call.resolve(result);
    }
}
