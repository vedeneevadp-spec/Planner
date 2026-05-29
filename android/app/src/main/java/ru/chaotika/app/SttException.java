package ru.chaotika.app;

final class SttException extends Exception {

    final SttError code;

    SttException(SttError code, String message) {
        super(message);
        this.code = code;
    }

    SttException(SttError code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }
}
