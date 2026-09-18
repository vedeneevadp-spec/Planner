package ru.chaotika.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

final class PlannerAppUpgradeCleanup {

    private static final String TAG = "PlannerUpgradeCleanup";

    private PlannerAppUpgradeCleanup() {}

    static void run(Context context) {
        // Run before the bridge starts. No completion flag: restored legacy data is
        // cleaned again, and a failed write can be retried on the next launch.
        runSafely(() -> context.stopService(
            new Intent().setClassName(context, "ru.chaotika.app.WakeWordService")
        ));
        for (String name : new String[] { "CapacitorStorage", "planner_secure_storage" }) {
            runSafely(() -> {
                if (!removeVoiceKeys(context.getSharedPreferences(name, Context.MODE_PRIVATE))) {
                    Log.w(TAG, "Retired settings cleanup will be retried on the next launch.");
                }
            });
        }
        runSafely(() -> {
            SharedPreferences preferences = context.getSharedPreferences(
                "planner.voice.training-examples",
                Context.MODE_PRIVATE
            );
            if (!removeTrainingOptIn(preferences)) {
                Log.w(TAG, "Retired sample opt-in cleanup will be retried on the next launch.");
            }
        });
        runSafely(() -> {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.cancel(1208);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    manager.deleteNotificationChannel("planner-voice-assistant");
                }
            }
        });
        // wakeword/haotika/{positive,real-world} contains personal recordings, not
        // disposable runtime caches. Preserve those files without any reader or
        // uploader; never clear shared files, auth storage, or the Android Keystore.
    }

    static boolean removeVoiceKeys(SharedPreferences preferences) {
        SharedPreferences.Editor editor = null;
        for (String key : preferences.getAll().keySet()) {
            if (key.startsWith("planner.voice.")) {
                if (editor == null) {
                    editor = preferences.edit();
                }
                editor.remove(key);
            }
        }
        return editor == null || editor.commit();
    }

    static boolean removeTrainingOptIn(SharedPreferences preferences) {
        String key = "wake-word-training-opt-in";
        return !preferences.contains(key) || preferences.edit().remove(key).commit();
    }

    private static void runSafely(Runnable cleanup) {
        try {
            cleanup.run();
        } catch (RuntimeException exception) {
            Log.w(TAG, "Retired feature cleanup will be retried on the next launch.");
        }
    }
}
