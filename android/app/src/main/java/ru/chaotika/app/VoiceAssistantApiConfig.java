package ru.chaotika.app;

import java.net.MalformedURLException;
import java.net.URL;
import java.util.UUID;

final class VoiceAssistantApiConfig {

    final String accessToken;
    final String actorUserId;
    final String apiBaseUrl;
    final String deviceId;
    final boolean wakeWordTrainingModeEnabled;
    final String voiceSessionId;
    final String workspaceId;

    VoiceAssistantApiConfig(
        String apiBaseUrl,
        String accessToken,
        String actorUserId,
        String workspaceId,
        boolean wakeWordTrainingModeEnabled
    ) {
        this(apiBaseUrl, accessToken, actorUserId, workspaceId, wakeWordTrainingModeEnabled, null, null);
    }

    VoiceAssistantApiConfig(
        String apiBaseUrl,
        String accessToken,
        String actorUserId,
        String workspaceId,
        boolean wakeWordTrainingModeEnabled,
        String deviceId,
        String voiceSessionId
    ) {
        this.apiBaseUrl = normalizeBaseUrl(apiBaseUrl);
        this.accessToken = normalizeNullable(accessToken);
        this.actorUserId = normalizeNullable(actorUserId);
        this.workspaceId = normalizeNullable(workspaceId);
        this.wakeWordTrainingModeEnabled = wakeWordTrainingModeEnabled;
        this.deviceId = normalizeOrUuid(deviceId);
        this.voiceSessionId = normalizeOrUuid(voiceSessionId);
    }

    boolean isUsable() {
        return apiBaseUrl != null && workspaceId != null && (accessToken != null || actorUserId != null);
    }

    private static String normalizeBaseUrl(String value) {
        String normalized = normalizeNullable(value);

        if (normalized == null) {
            return null;
        }

        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }

        return isLoopbackBaseUrl(normalized) ? null : normalized;
    }

    private static boolean isLoopbackBaseUrl(String value) {
        try {
            String host = new URL(value).getHost().toLowerCase(java.util.Locale.US);

            return host.equals("localhost") || host.equals("::1") || host.startsWith("127.");
        } catch (MalformedURLException ignored) {
            return true;
        }
    }

    private static String normalizeNullable(String value) {
        if (value == null) {
            return null;
        }

        String normalized = value.trim();

        return normalized.isEmpty() ? null : normalized;
    }

    private static String normalizeOrUuid(String value) {
        String normalized = normalizeNullable(value);

        return normalized == null ? UUID.randomUUID().toString() : normalized;
    }
}
