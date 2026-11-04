package ru.chaotika.app;

import java.net.URI;
import java.util.Arrays;
import org.json.JSONException;
import org.json.JSONObject;

record PlannerAppUpdate(long versionCode, String versionName, long sizeBytes, String sha256,
                        String abi, int minSdk, String notes, URI url) {
    static final URI ORIGIN = URI.create("https://chaotika.ru");
    static final long MAX_BYTES = 80L * 1024 * 1024;

    static PlannerAppUpdate parse(JSONObject value, URI origin) throws JSONException {
        long version = integer(value, "versionCode");
        String name = value.getString("versionName");
        long size = integer(value, "sizeBytes");
        String hash = value.getString("sha256");
        String abi = value.getString("abi");
        long sdk = integer(value, "minSdk");
        String notes = value.getString("notes");
        URI url = URI.create(value.getString("url"));
        String filename = "Chaotika-" + name + "-build" + version + "-" + abi + ".apk";
        if (integer(value, "formatVersion") != 1 || !"ru.chaotika.app".equals(value.getString("packageName"))
            || version <= 0 || version > 2100000000L || !name.matches("[0-9]+(\\.[0-9]+){1,3}")
            || size <= 0 || size > MAX_BYTES || !hash.matches("[0-9a-f]{64}")
            || !Arrays.asList("universal", "arm64-v8a", "armeabi-v7a", "x86", "x86_64").contains(abi)
            || sdk < 24 || sdk > 100 || notes.length() > 2000
            || !origin.getScheme().equals(url.getScheme()) || !origin.getHost().equals(url.getHost())
            || origin.getPort() != url.getPort() || url.getRawUserInfo() != null
            || url.getRawQuery() != null || url.getRawFragment() != null
            || !("/android-updates/" + filename).equals(url.getRawPath())) {
            throw new IllegalArgumentException("Invalid Android update manifest");
        }
        return new PlannerAppUpdate(version, name, size, hash, abi, (int) sdk, notes, url);
    }

    private static long integer(JSONObject value, String key) throws JSONException {
        Object number = value.get(key);
        if (!(number instanceof Integer) && !(number instanceof Long)) {
            throw new IllegalArgumentException("Expected integer: " + key);
        }
        return ((Number) number).longValue();
    }

    boolean supports(int sdk, String[] supportedAbis) {
        return minSdk <= sdk && ("universal".equals(abi) || Arrays.asList(supportedAbis).contains(abi));
    }

    JSONObject toJson() throws JSONException {
        return new JSONObject().put("formatVersion", 1).put("packageName", "ru.chaotika.app")
            .put("versionCode", versionCode).put("versionName", versionName).put("sizeBytes", sizeBytes)
            .put("sha256", sha256).put("abi", abi).put("minSdk", minSdk).put("notes", notes).put("url", url.toString());
    }
}
