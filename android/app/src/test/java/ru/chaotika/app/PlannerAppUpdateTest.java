package ru.chaotika.app;

import static org.junit.Assert.*;
import java.net.URI;
import org.json.JSONObject;
import org.junit.Test;

public class PlannerAppUpdateTest {
    private JSONObject manifest() throws Exception {
        return new JSONObject().put("formatVersion", 1).put("packageName", "ru.chaotika.app")
            .put("versionCode", 36).put("versionName", "1.1.28").put("sizeBytes", 6000000)
            .put("sha256", "a".repeat(64)).put("abi", "arm64-v8a").put("minSdk", 24)
            .put("notes", "Обновление внутри приложения")
            .put("url", "https://chaotika.ru/android-updates/Chaotika-1.1.28-build36-arm64-v8a.apk");
    }

    @Test public void roundTripsAndFiltersIncompatibleDevices() throws Exception {
        PlannerAppUpdate value = PlannerAppUpdate.parse(manifest(), PlannerAppUpdate.ORIGIN);
        assertEquals(value, PlannerAppUpdate.parse(value.toJson(), PlannerAppUpdate.ORIGIN));
        assertTrue(value.supports(35, new String[]{"arm64-v8a"}));
        assertFalse(value.supports(23, new String[]{"arm64-v8a"}));
        assertFalse(value.supports(35, new String[]{"x86_64"}));
    }

    @Test public void rejectsUntrustedOrAmbiguousDownloadLocations() throws Exception {
        for (String url : new String[]{
            "http://chaotika.ru/android-updates/Chaotika-1.1.28-build36-arm64-v8a.apk",
            "https://chaotika.ru.evil.test/android-updates/Chaotika-1.1.28-build36-arm64-v8a.apk",
            "https://user@chaotika.ru/android-updates/Chaotika-1.1.28-build36-arm64-v8a.apk",
            "https://chaotika.ru:444/android-updates/Chaotika-1.1.28-build36-arm64-v8a.apk",
            "https://chaotika.ru/android-updates/../other.apk",
            "https://chaotika.ru/android-updates/Chaotika-1.1.28-build36-arm64-v8a.apk?redirect=1",
            "https://chaotika.ru/android-updates/Chaotika-1.1.28-build37-arm64-v8a.apk"
        }) {
            JSONObject json = manifest().put("url", url);
            assertThrows(Exception.class, () -> PlannerAppUpdate.parse(json, PlannerAppUpdate.ORIGIN));
        }
    }

    @Test public void rejectsMalformedReleaseMetadata() throws Exception {
        for (Object[] mutation : new Object[][]{
            {"formatVersion", 2}, {"formatVersion", 1.5}, {"packageName", "other.app"}, {"versionCode", 0},
            {"versionCode", "36"}, {"versionCode", 36.5}, {"minSdk", 4294967320L},
            {"sizeBytes", -1}, {"sizeBytes", PlannerAppUpdate.MAX_BYTES + 1},
            {"sha256", "a"}, {"minSdk", 1}, {"notes", "x".repeat(2001)}
        }) {
            JSONObject json = manifest().put((String) mutation[0], mutation[1]);
            assertThrows(Exception.class, () -> PlannerAppUpdate.parse(json, URI.create("https://chaotika.ru")));
        }
    }
}
