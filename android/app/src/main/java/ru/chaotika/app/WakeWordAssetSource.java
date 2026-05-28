package ru.chaotika.app;

import java.io.IOException;

interface WakeWordAssetSource {
    boolean exists(String path);

    byte[] read(String path) throws IOException;
}
