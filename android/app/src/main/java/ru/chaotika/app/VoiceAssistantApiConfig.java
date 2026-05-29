package ru.chaotika.app;

final class VoiceAssistantApiConfig {

    final String accessToken;
    final String actorUserId;
    final String apiBaseUrl;
    final String workspaceId;

    VoiceAssistantApiConfig(
        String apiBaseUrl,
        String accessToken,
        String actorUserId,
        String workspaceId
    ) {
        this.apiBaseUrl = normalizeBaseUrl(apiBaseUrl);
        this.accessToken = normalizeNullable(accessToken);
        this.actorUserId = normalizeNullable(actorUserId);
        this.workspaceId = normalizeNullable(workspaceId);
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

        return normalized;
    }

    private static String normalizeNullable(String value) {
        if (value == null) {
            return null;
        }

        String normalized = value.trim();

        return normalized.isEmpty() ? null : normalized;
    }
}
