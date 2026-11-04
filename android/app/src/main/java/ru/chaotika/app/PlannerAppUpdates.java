package ru.chaotika.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.os.SystemClock;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.JSObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;
import org.json.JSONObject;

final class PlannerAppUpdates {
    static final long CHECK_INTERVAL = 24 * 60 * 60 * 1000L;
    private static PlannerAppUpdates instance;
    final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Context context;
    private final SharedPreferences preferences;
    private final URI origin;
    private final File directory;
    private volatile PlannerAppUpdate update;
    private volatile boolean downloading;
    private volatile int progress;
    volatile Consumer<JSObject> listener;

    static synchronized PlannerAppUpdates get(Context context) {
        if (instance == null) instance = new PlannerAppUpdates(context, PlannerAppUpdate.ORIGIN, "planner_app_updates");
        return instance;
    }

    // The production plugin always uses the fixed HTTPS origin; constructor injection is for device tests.
    PlannerAppUpdates(Context context, URI origin, String storageName) {
        this.context = context.getApplicationContext();
        this.origin = origin;
        preferences = context.getSharedPreferences(storageName, Context.MODE_PRIVATE);
        directory = new File(context.getCacheDir(), storageName);
        directory.mkdirs();
        try { update = PlannerAppUpdate.parse(new JSONObject(preferences.getString("manifest", "")), origin); }
        catch (Exception ignored) { update = null; }
    }

    PackageInfo installed() throws PackageManager.NameNotFoundException {
        return context.getPackageManager().getPackageInfo(context.getPackageName(), signingFlags());
    }

    static int signingFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    JSObject state() throws Exception {
        PackageInfo current = installed();
        PlannerAppUpdate candidate = update;
        if (candidate != null && (candidate.versionCode() <= PackageInfoCompat.getLongVersionCode(current)
            || !candidate.supports(Build.VERSION.SDK_INT, Build.SUPPORTED_ABIS))) {
            update = candidate = null;
            preferences.edit().remove("manifest").apply();
            if (!downloading) cleanFiles(null);
        }
        JSObject result = new JSObject();
        result.put("installedVersion", current.versionName);
        result.put("installedBuild", PackageInfoCompat.getLongVersionCode(current));
        result.put("update", candidate == null ? JSONObject.NULL : candidate.toJson());
        result.put("downloading", downloading);
        result.put("progress", progress);
        result.put("downloaded", candidate != null && apkFile(candidate).length() == candidate.sizeBytes());
        long dismissedAt = preferences.getLong("dismissedAt", 0);
        long now = System.currentTimeMillis();
        result.put("dismissed", candidate != null && preferences.getLong("dismissedBuild", 0) == candidate.versionCode()
            && now >= dismissedAt && now - dismissedAt < CHECK_INTERVAL);
        return result;
    }

    JSObject check(boolean force) throws Exception {
        long now = System.currentTimeMillis();
        long checkedAt = preferences.getLong("checkedAt", 0);
        if (downloading || (!force && now >= checkedAt && now - checkedAt < CHECK_INTERVAL)) return state();
        HttpURLConnection connection = connect(origin.resolve("/android-updates/latest.json"));
        try {
            int status = connection.getResponseCode();
            PlannerAppUpdate next;
            if (status == 404 || status == 204) next = null;
            else {
                if (status != 200) throw new IOException("Update check failed");
                try (InputStream input = connection.getInputStream()) {
                    next = PlannerAppUpdate.parse(new JSONObject(new String(readLimited(input, 32768), StandardCharsets.UTF_8)), origin);
                }
            }
            update = next;
            preferences.edit().putLong("checkedAt", now)
                .putString("manifest", next == null ? "" : next.toJson().toString()).apply();
            cleanFiles(next == null ? null : apkFile(next));
            return state();
        } finally { connection.disconnect(); }
    }

    JSObject dismiss() throws Exception {
        if (update != null) preferences.edit().putLong("dismissedBuild", update.versionCode())
            .putLong("dismissedAt", System.currentTimeMillis()).apply();
        return state();
    }

    JSObject download() throws Exception {
        state();
        PlannerAppUpdate candidate = update;
        if (candidate == null) throw new IOException("No compatible update");
        File target = apkFile(candidate);
        if (target.isFile()) {
            try { verifyApk(target, candidate); return state(); }
            catch (Exception ignored) { target.delete(); }
        }
        if (directory.getUsableSpace() < candidate.sizeBytes() + 8L * 1024 * 1024) throw new IOException("Not enough storage");
        File partial = new File(directory, "download.part");
        downloading = true;
        progress = 0;
        emit();
        HttpURLConnection connection = null;
        try {
            connection = connect(candidate.url());
            if (connection.getResponseCode() != 200) throw new IOException("Download failed");
            long declared = connection.getContentLengthLong();
            if (declared >= 0 && declared != candidate.sizeBytes()) throw new IOException("Unexpected APK length");
            long total = 0;
            long started = SystemClock.elapsedRealtime();
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[65536];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (SystemClock.elapsedRealtime() - started > 10 * 60 * 1000L) throw new IOException("Download timed out");
                    total += read;
                    if (total > candidate.sizeBytes()) throw new IOException("APK exceeds expected size");
                    output.write(buffer, 0, read);
                    int next = (int) (total * 100 / candidate.sizeBytes());
                    if (next != progress) { progress = next; emit(); }
                }
                output.getFD().sync();
            }
            verifyApk(partial, candidate);
            if (!partial.renameTo(target)) throw new IOException("Could not save APK");
        } finally {
            if (connection != null) connection.disconnect();
            partial.delete();
            downloading = false;
            emit();
        }
        return state();
    }

    File verifiedInstallerFile() throws Exception {
        state();
        PlannerAppUpdate candidate = update;
        if (candidate == null) throw new IOException("No update to install");
        File file = apkFile(candidate);
        try { verifyApk(file, candidate); }
        catch (Exception error) { file.delete(); throw error; }
        return file;
    }

    void verifyApk(File file, PlannerAppUpdate candidate) throws Exception {
        if (file.length() != candidate.sizeBytes() || !candidate.sha256().equals(sha256(file))) throw new IOException("APK integrity check failed");
        PackageInfo archive = context.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), signingFlags());
        verifyIdentity(archive, installed(), candidate);
    }

    static void verifyIdentity(PackageInfo archive, PackageInfo current, PlannerAppUpdate candidate) throws IOException {
        if (archive == null || !current.packageName.equals(archive.packageName)
            || PackageInfoCompat.getLongVersionCode(archive) != candidate.versionCode()
            || PackageInfoCompat.getLongVersionCode(archive) <= PackageInfoCompat.getLongVersionCode(current)
            || !candidate.versionName().equals(archive.versionName)
            || archive.applicationInfo == null || current.applicationInfo == null || archive.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT
            || ((current.applicationInfo.flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0
                && (archive.applicationInfo.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0)) throw new IOException("APK identity check failed");
        Signature[] expected = signatures(current);
        Signature[] actual = signatures(archive);
        if (expected == null || actual == null || expected.length == 0
            || !new HashSet<>(Arrays.asList(expected)).equals(new HashSet<>(Arrays.asList(actual)))) throw new IOException("APK signature mismatch");
    }

    private static Signature[] signatures(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28
            ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
    }

    static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[65536]; int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        StringBuilder result = new StringBuilder();
        for (byte b : digest.digest()) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }

    static byte[] readLimited(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        long started = SystemClock.elapsedRealtime();
        byte[] buffer = new byte[4096]; int read;
        while ((read = input.read(buffer)) != -1) {
            if (SystemClock.elapsedRealtime() - started > 30000) throw new IOException("Update check timed out");
            if (output.size() + read > limit) throw new IOException("Manifest too large");
            output.write(buffer, 0, read);
        }
        return output.toByteArray();
    }

    private HttpURLConnection connect(URI uri) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(20000);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        connection.setRequestProperty("Accept-Encoding", "identity");
        return connection;
    }

    private File apkFile(PlannerAppUpdate candidate) { return new File(directory, candidate.sha256() + ".apk"); }
    private void cleanFiles(File keep) {
        File[] files = directory.listFiles();
        if (files != null) for (File file : files) if (!file.equals(keep) && file.isFile()) file.delete();
    }
    private void emit() {
        Consumer<JSObject> current = listener;
        if (current != null) try { current.accept(state()); } catch (Exception ignored) { /* Next state read retries. */ }
    }
}
