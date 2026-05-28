package ru.chaotika.app;

import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

final class WakeWordModelManifest {

    final String modelVersion;

    private WakeWordModelManifest(String modelVersion) {
        this.modelVersion = modelVersion;
    }

    static WakeWordModelManifest read(WakeWordAssetSource assets, WakeWordConfig config) throws WakeWordError {
        try {
            if (!assets.exists(config.manifestPath)) {
                throw WakeWordError.invalidModelManifest(
                    "Wake-word manifest is missing: " + config.manifestPath,
                    null
                );
            }

            JSONObject value = new JSONObject(new String(assets.read(config.manifestPath), StandardCharsets.UTF_8));

            requireString(value, "phraseId", config.phraseId);
            requireString(value, "displayPhrase", config.displayPhrase);
            requireString(value, "language", config.language);
            requireString(value, "modelPath", config.modelPath);
            requireDouble(value, "threshold", config.threshold);
            requireInt(value, "sampleRate", config.sampleRate);
            requireBoolean(value, "vadEnabled", config.vadEnabled);

            return new WakeWordModelManifest(value.optString("modelVersion", "unknown"));
        } catch (WakeWordError error) {
            throw error;
        } catch (Exception error) {
            throw WakeWordError.invalidModelManifest("Wake-word manifest is invalid.", error);
        }
    }

    private static void requireString(JSONObject value, String key, String expected) throws WakeWordError, JSONException {
        String actual = value.getString(key);

        if (!expected.equals(actual)) {
            throw WakeWordError.invalidModelManifest(
                "Wake-word manifest " + key + " must be " + expected + ", got " + actual + ".",
                null
            );
        }
    }

    private static void requireDouble(JSONObject value, String key, float expected) throws WakeWordError, JSONException {
        double actual = value.getDouble(key);

        if (Math.abs(expected - actual) > 0.0001d) {
            throw WakeWordError.invalidModelManifest(
                "Wake-word manifest " + key + " must be " + expected + ", got " + actual + ".",
                null
            );
        }
    }

    private static void requireInt(JSONObject value, String key, int expected) throws WakeWordError, JSONException {
        int actual = value.getInt(key);

        if (expected != actual) {
            throw WakeWordError.invalidModelManifest(
                "Wake-word manifest " + key + " must be " + expected + ", got " + actual + ".",
                null
            );
        }
    }

    private static void requireBoolean(JSONObject value, String key, boolean expected) throws WakeWordError, JSONException {
        boolean actual = value.getBoolean(key);

        if (expected != actual) {
            throw WakeWordError.invalidModelManifest(
                "Wake-word manifest " + key + " must be " + expected + ", got " + actual + ".",
                null
            );
        }
    }
}
