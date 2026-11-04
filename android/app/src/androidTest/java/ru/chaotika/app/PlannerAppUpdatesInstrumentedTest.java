package ru.chaotika.app;

import static org.junit.Assert.*;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Parcel;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Assume;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PlannerAppUpdatesInstrumentedTest {
    private Context context;
    private TestFeed feed;
    private PlannerAppUpdates updates;
    private String storage;

    @Before public void setUp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        storage = "update_test_" + UUID.randomUUID();
        feed = new TestFeed();
        updates = new PlannerAppUpdates(context, feed.origin(), storage);
        feed.manifest = manifest(new byte[]{1, 2, 3}).toString();
    }

    @After public void tearDown() throws Exception {
        updates.executor.shutdownNow();
        feed.close();
        context.getSharedPreferences(storage, Context.MODE_PRIVATE).edit().clear().commit();
        File directory = new File(context.getCacheDir(), storage);
        File[] files = directory.listFiles();
        if (files != null) for (File file : files) file.delete();
        directory.delete();
    }

    private JSONObject manifest(byte[] bytes) throws Exception {
        long code = PackageInfoCompat.getLongVersionCode(updates.installed()) + 1;
        return new JSONObject().put("formatVersion", 1).put("packageName", context.getPackageName())
            .put("versionCode", code).put("versionName", "1.1.28").put("sizeBytes", bytes.length)
            .put("sha256", hex(MessageDigest.getInstance("SHA-256").digest(bytes)))
            .put("abi", Build.SUPPORTED_ABIS[0]).put("minSdk", 24).put("notes", "Тест обновления")
            .put("url", feed.origin() + "/android-updates/Chaotika-1.1.28-build" + code + "-" + Build.SUPPORTED_ABIS[0] + ".apk");
    }

    @Test public void cachesChecksAndDismissalAcrossProcessStateAndAllowsManualCheck() throws Exception {
        assertFalse(updates.check(false).isNull("update"));
        assertEquals(1, feed.checks);
        assertTrue(updates.dismiss().getBoolean("dismissed"));
        PlannerAppUpdates restored = new PlannerAppUpdates(context, feed.origin(), storage);
        try {
            assertTrue(restored.check(false).getBoolean("dismissed"));
            assertEquals(1, feed.checks);
            restored.check(true);
            assertEquals(2, feed.checks);
            context.getSharedPreferences(storage, Context.MODE_PRIVATE).edit()
                .putLong("checkedAt", System.currentTimeMillis() - PlannerAppUpdates.CHECK_INTERVAL - 1000)
                .putLong("dismissedAt", System.currentTimeMillis() - PlannerAppUpdates.CHECK_INTERVAL - 1000).commit();
            assertFalse(restored.check(false).getBoolean("dismissed"));
            assertEquals(3, feed.checks);
        } finally { restored.executor.shutdownNow(); }
    }

    @Test public void ignoresMissingCurrentAndIncompatibleReleases() throws Exception {
        feed.status = 404;
        assertTrue(updates.check(true).isNull("update"));
        feed.status = 200;
        JSONObject json = new JSONObject(feed.manifest);
        long current = PackageInfoCompat.getLongVersionCode(updates.installed());
        json.put("versionCode", current).put("url", json.getString("url").replace("build" + (current + 1), "build" + current));
        feed.manifest = json.toString();
        assertTrue(updates.check(true).isNull("update"));
        feed.manifest = manifest(new byte[]{1, 2, 3}).put("minSdk", Build.VERSION.SDK_INT + 1).toString();
        assertTrue(updates.check(true).isNull("update"));
    }

    @Test public void rejectsRedirectsAndOversizedMetadataWithoutCachingFailure() throws Exception {
        feed.status = 302;
        assertThrows(Exception.class, () -> updates.check(false));
        assertEquals(1, feed.checks);
        feed.status = 200;
        feed.manifest = "x".repeat(32769);
        assertThrows(Exception.class, () -> updates.check(false));
        feed.manifest = manifest(new byte[]{1, 2, 3}).toString();
        assertFalse(updates.check(false).isNull("update"));
        assertEquals(3, feed.checks);
        assertFalse(feed.requests.stream().anyMatch(request -> request.toLowerCase().contains("authorization:")));
    }

    @Test public void discardsBrokenDownloadsAndNeverExposesAnInstallerFile() throws Exception {
        updates.check(true);
        for (byte[] bytes : new byte[][]{new byte[]{1}, new byte[]{9, 9, 9}, new byte[]{1, 2, 3}}) {
            feed.apk = bytes; // Wrong size, wrong hash, then non-APK with the correct hash.
            assertThrows(Exception.class, () -> updates.download());
            assertFalse(updates.state().getBoolean("downloading"));
            assertFalse(updates.state().getBoolean("downloaded"));
            assertThrows(Exception.class, () -> updates.verifiedInstallerFile());
            assertFalse(new File(context.getCacheDir(), storage + "/download.part").exists());
        }
    }

    @Test public void validatesRealPackageIdentityAndSigningCertificates() throws Exception {
        PackageInfo actual = updates.installed();
        PackageInfo older = copy(actual);
        setVersion(older, PackageInfoCompat.getLongVersionCode(actual) - 1);
        PlannerAppUpdate candidate = new PlannerAppUpdate(PackageInfoCompat.getLongVersionCode(actual), actual.versionName,
            1, "a".repeat(64), Build.SUPPORTED_ABIS[0], 24, "", URI.create("https://chaotika.ru"));
        PlannerAppUpdates.verifyIdentity(actual, older, candidate);
        assertThrows(Exception.class, () -> PlannerAppUpdates.verifyIdentity(actual, actual, candidate));
        PackageInfo other = copy(actual);
        other.packageName = "another.app";
        assertThrows(Exception.class, () -> PlannerAppUpdates.verifyIdentity(other, older, candidate));
        PackageInfo unsigned = copy(actual);
        if (Build.VERSION.SDK_INT >= 28) unsigned.signingInfo = null;
        unsigned.signatures = null;
        assertThrows(Exception.class, () -> PlannerAppUpdates.verifyIdentity(unsigned, older, candidate));
        PackageInfo otherSigner = copy(actual);
        PackageInfo platform = context.getPackageManager().getPackageInfo("android", PlannerAppUpdates.signingFlags());
        if (Build.VERSION.SDK_INT >= 28) otherSigner.signingInfo = platform.signingInfo;
        else otherSigner.signatures = platform.signatures;
        assertThrows(Exception.class, () -> PlannerAppUpdates.verifyIdentity(otherSigner, older, candidate));
        PackageInfo wrongVersion = copy(actual);
        wrongVersion.versionName = "0.0";
        assertThrows(Exception.class, () -> PlannerAppUpdates.verifyIdentity(wrongVersion, older, candidate));
    }

    // Supply an APK built from this source with versionCode+1 and the same debug key.
    @Test public void downloadsVerifiesAndReusesRealSignedUpgrade() throws Exception {
        String fixturePath = InstrumentationRegistry.getArguments().getString("updateApk");
        Assume.assumeTrue("Pass -e updateApk <device APK path> for the signed upgrade test", fixturePath != null);
        File fixture = new File(fixturePath);
        try (FileInputStream input = new FileInputStream(fixture)) { feed.apk = input.readAllBytes(); }
        PackageInfo archive = context.getPackageManager().getPackageArchiveInfo(fixturePath, PlannerAppUpdates.signingFlags());
        assertNotNull(archive);
        JSONObject json = manifest(feed.apk);
        assertEquals(json.getLong("versionCode"), PackageInfoCompat.getLongVersionCode(archive));
        json.put("versionName", archive.versionName)
            .put("url", json.getString("url").replace("1.1.28", archive.versionName));
        feed.manifest = json.toString();
        updates.check(true);
        assertTrue(updates.download().getBoolean("downloaded"));
        File verified = updates.verifiedInstallerFile();
        assertEquals(json.getString("sha256"), PlannerAppUpdates.sha256(verified));
        assertEquals(1, feed.downloads);
        assertTrue(updates.download().getBoolean("downloaded"));
        assertEquals(1, feed.downloads);
        // Cache tampering must be detected again immediately before installation.
        try (FileOutputStream output = new FileOutputStream(verified)) { output.write(new byte[]{0}); }
        assertThrows(Exception.class, () -> updates.verifiedInstallerFile());
        assertFalse(verified.exists());
        assertTrue(updates.download().getBoolean("downloaded"));
        assertEquals(2, feed.downloads);
    }

    private static void setVersion(PackageInfo info, long version) {
        if (Build.VERSION.SDK_INT >= 28) info.setLongVersionCode(version);
        else info.versionCode = (int) version;
    }
    private static PackageInfo copy(PackageInfo info) {
        Parcel parcel = Parcel.obtain();
        try {
            info.writeToParcel(parcel, 0); parcel.setDataPosition(0);
            return PackageInfo.CREATOR.createFromParcel(parcel);
        } finally { parcel.recycle(); }
    }
    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }

    private static final class TestFeed implements AutoCloseable {
        final ServerSocket server = new ServerSocket(0, 4, java.net.InetAddress.getByName("127.0.0.1"));
        volatile int status = 200;
        volatile int checks;
        volatile int downloads;
        volatile String manifest = "{}";
        volatile byte[] apk = new byte[]{1, 2, 3};
        final List<String> requests = Collections.synchronizedList(new ArrayList<>());
        final Thread thread;
        TestFeed() throws Exception {
            thread = new Thread(() -> {
                while (!server.isClosed()) try (Socket socket = server.accept()) {
                    socket.setSoTimeout(5000);
                    BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                    String first = reader.readLine();
                    StringBuilder request = new StringBuilder(first);
                    String line;
                    while ((line = reader.readLine()) != null && !line.isEmpty()) request.append('\n').append(line);
                    requests.add(request.toString());
                    boolean metadata = first.contains("/latest.json ");
                    if (metadata) checks++; else downloads++;
                    byte[] body = metadata ? manifest.getBytes(StandardCharsets.UTF_8) : apk;
                    socket.getOutputStream().write(("HTTP/1.1 " + status + " Test\r\nContent-Length: " + body.length
                        + "\r\nLocation: " + origin() + "/redirect\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));
                    socket.getOutputStream().write(body);
                } catch (Exception ignored) { /* The client may reject the response before reading it. */ }
            }, "test-update-feed");
            thread.setDaemon(true); thread.start();
        }
        URI origin() { return URI.create("http://127.0.0.1:" + server.getLocalPort()); }
        @Override public void close() throws Exception { server.close(); thread.join(1000); }
    }
}
