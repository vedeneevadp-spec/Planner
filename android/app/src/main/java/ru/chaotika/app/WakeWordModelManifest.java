package ru.chaotika.app;

import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

final class WakeWordModelManifest {

    final String modelVersion;
    final float threshold;

    private WakeWordModelManifest(String modelVersion, float threshold) {
        this.modelVersion = modelVersion;
        this.threshold = threshold;
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
            float threshold = readThreshold(value);
            requireInt(value, "sampleRate", config.sampleRate);
            requireBoolean(value, "vadEnabled", config.vadEnabled);

            return new WakeWordModelManifest(value.optString("modelVersion", "unknown"), threshold);
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

    private static float readThreshold(JSONObject value) throws WakeWordError, JSONException {
        String key = "threshold";
        double actual = value.getDouble(key);

        if (!Double.isFinite(actual) || actual < 0d || actual > 1d) {
            throw WakeWordError.invalidModelManifest(
                "Wake-word manifest " + key + " must be between 0 and 1, got " + actual + ".",
                null
            );
        }

        return (float) actual;
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
