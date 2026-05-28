package ru.chaotika.app;

import android.content.Context;
import android.content.res.AssetManager;
import java.io.IOException;
import java.io.InputStream;

final class AndroidWakeWordAssetSource implements WakeWordAssetSource {

    private final AssetManager assetManager;

    AndroidWakeWordAssetSource(Context context) {
        assetManager = context.getApplicationContext().getAssets();
    }

    @Override
    public boolean exists(String path) {
        try (InputStream ignored = assetManager.open(path)) {
            return true;
        } catch (IOException error) {
            return false;
        }
    }

    @Override
    public byte[] read(String path) throws IOException {
        try (InputStream input = assetManager.open(path)) {
            return input.readAllBytes();
        }
    }
}
