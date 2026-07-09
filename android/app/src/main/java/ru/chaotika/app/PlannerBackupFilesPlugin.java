package ru.chaotika.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "PlannerBackupFiles")
public class PlannerBackupFilesPlugin extends Plugin {

    private static final String BACKUP_DIRECTORY = "Chaotika";
    private static final String DEFAULT_FILE_NAME = "planner-backup.json";
    private static final String DEFAULT_MIME_TYPE = "application/json";

    @PluginMethod
    public void saveTextFile(PluginCall call) {
        String text = call.getString("text");

        if (text == null) {
            call.reject("text is required.");
            return;
        }

        String fileName = sanitizeFileName(call.getString("fileName"));
        String mimeType = call.getString("mimeType");

        if (mimeType == null || mimeType.trim().isEmpty()) {
            mimeType = DEFAULT_MIME_TYPE;
        }

        try {
            SaveResult result = saveTextFile(fileName, mimeType, text);
            JSObject response = new JSObject();

            response.put("displayPath", result.displayPath);
            response.put("fileName", result.fileName);
            response.put("uri", result.uri);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Не удалось сохранить файл резервной копии.", error);
        }
    }

    private SaveResult saveTextFile(String fileName, String mimeType, String text) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return saveTextFileToDownloads(fileName, mimeType, text);
        }

        return saveTextFileToAppDownloads(fileName, text);
    }

    private SaveResult saveTextFileToDownloads(String fileName, String mimeType, String text) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        String relativePath = Environment.DIRECTORY_DOWNLOADS + File.separator + BACKUP_DIRECTORY;
        Uri itemUri = null;

        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mimeType);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, relativePath);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);

        if (itemUri == null) {
            throw new IllegalStateException("Downloads provider returned null uri.");
        }

        try (OutputStream outputStream = resolver.openOutputStream(itemUri)) {
            if (outputStream == null) {
                throw new IllegalStateException("Downloads provider returned null output stream.");
            }

            outputStream.write(text.getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) {
            resolver.delete(itemUri, null, null);
            throw error;
        }

        ContentValues publishedValues = new ContentValues();

        publishedValues.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(itemUri, publishedValues, null, null);

        return new SaveResult(
            fileName,
            "Загрузки/" + BACKUP_DIRECTORY + "/" + fileName,
            itemUri.toString()
        );
    }

    private SaveResult saveTextFileToAppDownloads(String fileName, String text) throws Exception {
        File rootDirectory = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);

        if (rootDirectory == null) {
            rootDirectory = getContext().getFilesDir();
        }

        File backupDirectory = new File(rootDirectory, BACKUP_DIRECTORY);

        if (!backupDirectory.exists() && !backupDirectory.mkdirs()) {
            throw new IllegalStateException("Backup directory could not be created.");
        }

        File backupFile = new File(backupDirectory, fileName);

        try (FileOutputStream outputStream = new FileOutputStream(backupFile)) {
            outputStream.write(text.getBytes(StandardCharsets.UTF_8));
        }

        return new SaveResult(
            fileName,
            "Файлы приложения/" + BACKUP_DIRECTORY + "/" + fileName,
            Uri.fromFile(backupFile).toString()
        );
    }

    private static String sanitizeFileName(String rawFileName) {
        String fileName = rawFileName == null ? "" : rawFileName.trim();

        if (fileName.isEmpty()) {
            fileName = DEFAULT_FILE_NAME;
        }

        fileName = fileName.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]+", "_");
        fileName = fileName.replaceAll("\\s+", " ");

        if (!fileName.toLowerCase(java.util.Locale.ROOT).endsWith(".json")) {
            fileName = fileName + ".json";
        }

        if (fileName.length() > 140) {
            fileName = fileName.substring(0, 135) + ".json";
        }

        return fileName;
    }

    private static final class SaveResult {
        final String displayPath;
        final String fileName;
        final String uri;

        SaveResult(String fileName, String displayPath, String uri) {
            this.displayPath = displayPath;
            this.fileName = fileName;
            this.uri = uri;
        }
    }
}
