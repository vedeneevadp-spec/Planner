package ru.chaotika.app;

import java.security.SecureRandom;
import java.util.Locale;

final class PlannerUuidV7 {
    private static final SecureRandom RANDOM = new SecureRandom();

    private PlannerUuidV7() {}

    static String generate() {
        byte[] value = new byte[16];
        long timestamp = System.currentTimeMillis();

        RANDOM.nextBytes(value);
        value[0] = (byte) (timestamp >>> 40);
        value[1] = (byte) (timestamp >>> 32);
        value[2] = (byte) (timestamp >>> 24);
        value[3] = (byte) (timestamp >>> 16);
        value[4] = (byte) (timestamp >>> 8);
        value[5] = (byte) timestamp;
        value[6] = (byte) ((value[6] & 0x0f) | 0x70);
        value[8] = (byte) ((value[8] & 0x3f) | 0x80);

        return String.format(
            Locale.US,
            "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
            value[0] & 0xff,
            value[1] & 0xff,
            value[2] & 0xff,
            value[3] & 0xff,
            value[4] & 0xff,
            value[5] & 0xff,
            value[6] & 0xff,
            value[7] & 0xff,
            value[8] & 0xff,
            value[9] & 0xff,
            value[10] & 0xff,
            value[11] & 0xff,
            value[12] & 0xff,
            value[13] & 0xff,
            value[14] & 0xff,
            value[15] & 0xff
        );
    }
}
