package ru.chaotika.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.function.Consumer;

@CapacitorPlugin(name = "PlannerAppUpdates")
public class PlannerAppUpdatesPlugin extends Plugin {
    private PlannerAppUpdates updates;
    private Consumer<JSObject> listener;

    @Override public void load() {
        updates = PlannerAppUpdates.get(getContext());
        listener = state -> notifyListeners("stateChange", state);
        updates.listener = listener;
    }

    @Override protected void handleOnDestroy() {
        if (updates != null && updates.listener == listener) updates.listener = null;
    }

    @PluginMethod public void getState(PluginCall call) { run(call, () -> updates.state()); }
    @PluginMethod public void check(PluginCall call) { run(call, () -> updates.check(Boolean.TRUE.equals(call.getBoolean("force", false)))); }
    @PluginMethod public void download(PluginCall call) { run(call, () -> updates.download()); }
    @PluginMethod public void dismiss(PluginCall call) { run(call, () -> updates.dismiss()); }

    @PluginMethod public void install(PluginCall call) {
        openInstaller(call);
    }

    @ActivityCallback private void installPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            call.reject("Для обновления разрешите установку из Хаотики.", "INSTALL_PERMISSION");
            return;
        }
        openInstaller(call);
    }

    private void openInstaller(PluginCall call) {
        updates.executor.execute(() -> {
            try {
                File file = updates.verifiedInstallerFile();
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                Intent intent = new Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                        try {
                            startActivityForResult(call, new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
                                .setData(Uri.parse("package:" + getContext().getPackageName())), "installPermissionResult");
                        } catch (RuntimeException error) { call.reject("Не удалось открыть разрешение на установку.", "INSTALL_PERMISSION", error); }
                        return;
                    }
                    try { getActivity().startActivity(intent); call.resolve(); }
                    catch (RuntimeException error) { call.reject("Не удалось открыть установщик Android.", "INSTALL_FAILED", error); }
                });
            } catch (Exception error) { call.reject("Не удалось проверить файл обновления. Скачайте его ещё раз.", "UPDATE_INVALID", error); }
        });
    }

    private interface Operation { JSObject run() throws Exception; }
    private void run(PluginCall call, Operation operation) {
        updates.executor.execute(() -> {
            try { call.resolve(operation.run()); }
            catch (Exception error) { call.reject("Не удалось выполнить обновление. Проверьте интернет и свободное место.", "UPDATE_FAILED", error); }
        });
    }
}
