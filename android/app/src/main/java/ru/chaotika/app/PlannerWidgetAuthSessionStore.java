package ru.chaotika.app;

import android.content.Context;
import java.security.SecureRandom;
import java.util.Date;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONException;
import org.json.JSONObject;

final class PlannerWidgetAuthSessionStore {

    private static final String AUTH_SESSION_KEY = "planner.auth.planner.auth.session";
    private static final String DEVICE_ID_KEY = "planner.auth.deviceId";
    private static final String LEGACY_PREFERENCES_NAME = "CapacitorStorage";
    private static final Object STORAGE_LOCK = new Object();

    private PlannerWidgetAuthSessionStore() {}

    static PlannerWidgetAuthSession read(Context context) {
        synchronized (STORAGE_LOCK) {
            return readLocked(context);
        }
    }

    static PlannerWidgetAuthSession prepareForRefresh(
        Context context,
        PlannerWidgetAuthSession expectedSession
    ) {
        synchronized (STORAGE_LOCK) {
            PlannerWidgetAuthSession latest = readLocked(context);

            if (latest == null) {
                return null;
            }

            if (
                expectedSession != null &&
                !latest.refreshToken.equals(expectedSession.refreshToken)
            ) {
                return latest;
            }

            if (latest.refreshRotationRequestId != null) {
                return latest;
            }

            PlannerWidgetAuthSession prepared = latest.withRotationRequestId(
                PlannerWidgetUuidV7.generate()
            );

            return writeLocked(context, prepared) ? prepared : null;
        }
    }

    static PlannerWidgetAuthSession commitRefresh(
        Context context,
        PlannerWidgetAuthSession attemptedSession,
        PlannerWidgetAuthSession refreshedSession
    ) {
        synchronized (STORAGE_LOCK) {
            PlannerWidgetAuthSession latest = readLocked(context);

            if (latest == null) {
                return null;
            }

            boolean isSameOperation =
                latest.refreshToken.equals(attemptedSession.refreshToken) &&
                equalNullable(
                    latest.refreshRotationRequestId,
                    attemptedSession.refreshRotationRequestId
                );

            if (isSameOperation) {
                return writeLocked(context, refreshedSession) ? refreshedSession : null;
            }

            // Another foreground/background refresh may have committed the exact
            // same deterministic rotation or advanced the token family further.
            // Never overwrite that newer durable state.
            return latest;
        }
    }

    static String getOrCreateDeviceId(Context context) {
        synchronized (STORAGE_LOCK) {
            String existing = PlannerSecureStorage.getString(
                context,
                DEVICE_ID_KEY,
                LEGACY_PREFERENCES_NAME
            );

            if (existing != null && !existing.trim().isEmpty() && existing.length() <= 128) {
                return existing.trim();
            }

            String nextDeviceId = "native-" + UUID.randomUUID();
            boolean stored = PlannerSecureStorage.putString(
                context,
                DEVICE_ID_KEY,
                nextDeviceId,
                LEGACY_PREFERENCES_NAME
            );

            if (!stored) {
                throw new IllegalStateException("Failed to persist widget auth device id.");
            }

            return nextDeviceId;
        }
    }

    private static PlannerWidgetAuthSession readLocked(Context context) {
        String rawSession = PlannerSecureStorage.getString(
            context,
            AUTH_SESSION_KEY,
            LEGACY_PREFERENCES_NAME
        );

        return PlannerWidgetAuthSession.parse(rawSession);
    }

    private static boolean writeLocked(Context context, PlannerWidgetAuthSession session) {
        return PlannerSecureStorage.putString(
            context,
            AUTH_SESSION_KEY,
            session.toJson().toString(),
            LEGACY_PREFERENCES_NAME
        );
    }

    private static boolean equalNullable(String left, String right) {
        return left == null ? right == null : left.equals(right);
    }
}

final class PlannerWidgetAuthSession {
    final String accessToken;
    final String email;
    final String expiresAt;
    final String refreshRotationRequestId;
    final String refreshToken;
    final String userId;

    PlannerWidgetAuthSession(
        String accessToken,
        String email,
        String expiresAt,
        String refreshToken,
        String refreshRotationRequestId,
        String userId
    ) {
        this.accessToken = accessToken;
        this.email = email;
        this.expiresAt = expiresAt;
        this.refreshToken = refreshToken;
        this.refreshRotationRequestId = refreshRotationRequestId;
        this.userId = userId;
    }

    boolean isAccessTokenUsable(Date now, long refreshAheadMillis) {
        Long expiryMillis = PlannerWidgetSnapshotFactory.parseInstantMillis(expiresAt);

        return expiryMillis != null && expiryMillis > now.getTime() + refreshAheadMillis;
    }

    PlannerWidgetAuthSession withRotationRequestId(String requestId) {
        return new PlannerWidgetAuthSession(
            accessToken,
            email,
            expiresAt,
            refreshToken,
            requestId,
            userId
        );
    }

    JSONObject toJson() {
        JSONObject value = new JSONObject();

        try {
            value.put("accessToken", accessToken);
            value.put("email", email);
            value.put("expiresAt", expiresAt);
            value.put("refreshRotationRequestId", refreshRotationRequestId);
            value.put("refreshToken", refreshToken);
            value.put("userId", userId);
        } catch (JSONException exception) {
            throw new IllegalStateException("Failed to serialize widget auth session.", exception);
        }

        return value;
    }

    static PlannerWidgetAuthSession parse(String rawSession) {
        if (rawSession == null || rawSession.trim().isEmpty()) {
            return null;
        }

        try {
            JSONObject value = new JSONObject(rawSession);
            String accessToken = requiredString(value, "accessToken");
            String email = requiredString(value, "email");
            String expiresAt = requiredString(value, "expiresAt");
            String refreshToken = requiredString(value, "refreshToken");
            String userId = requiredString(value, "userId");
            String rotationRequestId = optionalString(value, "refreshRotationRequestId");

            if (
                accessToken == null ||
                email == null ||
                expiresAt == null ||
                refreshToken == null ||
                userId == null
            ) {
                return null;
            }

            return new PlannerWidgetAuthSession(
                accessToken,
                email,
                expiresAt,
                refreshToken,
                rotationRequestId,
                userId
            );
        } catch (JSONException exception) {
            return null;
        }
    }

    static PlannerWidgetAuthSession fromRefreshResponse(JSONObject response) {
        if (response == null) {
            return null;
        }

        JSONObject user = response.optJSONObject("user");
        String accessToken = requiredString(response, "accessToken");
        String expiresAt = requiredString(response, "expiresAt");
        String refreshToken = requiredString(response, "refreshToken");
        String email = requiredString(user, "email");
        String userId = requiredString(user, "id");

        if (
            accessToken == null ||
            expiresAt == null ||
            refreshToken == null ||
            email == null ||
            userId == null
        ) {
            return null;
        }

        return new PlannerWidgetAuthSession(
            accessToken,
            email,
            expiresAt,
            refreshToken,
            PlannerWidgetUuidV7.generate(),
            userId
        );
    }

    private static String requiredString(JSONObject value, String key) {
        String result = optionalString(value, key);

        return result == null || result.isEmpty() ? null : result;
    }

    private static String optionalString(JSONObject value, String key) {
        if (value == null || value.isNull(key)) {
            return null;
        }

        String result = value.optString(key, "").trim();

        return result.isEmpty() ? null : result;
    }
}

final class PlannerWidgetUuidV7 {
    private static final SecureRandom RANDOM = new SecureRandom();

    private PlannerWidgetUuidV7() {}

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
