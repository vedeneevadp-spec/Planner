package ru.chaotika.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class PlannerWidgetNetworkClient {

    private static final int CONNECT_TIMEOUT_MILLIS = 15_000;
    private static final int MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
    private static final int READ_TIMEOUT_MILLIS = 25_000;
    private static final String USER_AGENT = "Chaotika-Android-Widget/1";

    private final PlannerWidgetSyncConfig config;

    PlannerWidgetNetworkClient(PlannerWidgetSyncConfig config) {
        this.config = config;
    }

    PlannerWidgetRemoteData loadWidgetData(String accessToken, String dateKey)
        throws IOException, JSONException, PlannerWidgetHttpException {
        String encodedDate = URLEncoder.encode(dateKey, StandardCharsets.UTF_8.name());
        JSONArray tasks = getObject(
            "/api/v1/tasks/read-model?dateFrom=" + encodedDate
                + "&dateTo=" + encodedDate
                + "&activeLimit=500&rangeLimit=250&historyLimit=0",
            accessToken
        ).getJSONArray("items");
        JSONArray spheres = getArray("/api/v1/life-spheres", accessToken);
        JSONObject selfCare = getObject(
            "/api/v1/self-care/dashboard?date=" + encodedDate,
            accessToken
        );
        JSONObject cleaning = getObject(
            "/api/v1/cleaning/today?date=" + encodedDate,
            accessToken
        );

        return new PlannerWidgetRemoteData(tasks, spheres, selfCare, cleaning);
    }

    JSONObject refreshAuthSession(
        PlannerWidgetAuthSession session,
        String deviceId
    ) throws IOException, JSONException, PlannerWidgetHttpException {
        JSONObject body = new JSONObject();

        body.put("refreshToken", session.refreshToken);

        if (session.refreshRotationRequestId != null) {
            body.put("rotationRequestId", session.refreshRotationRequestId);
        }

        return requestObject(
            "/api/v1/auth/refresh",
            "POST",
            null,
            body.toString(),
            deviceId
        );
    }

    private JSONArray getArray(String path, String accessToken)
        throws IOException, JSONException, PlannerWidgetHttpException {
        String body = request(path, "GET", accessToken, null, null);

        return new JSONArray(body);
    }

    private JSONObject getObject(String path, String accessToken)
        throws IOException, JSONException, PlannerWidgetHttpException {
        return requestObject(path, "GET", accessToken, null, null);
    }

    private JSONObject requestObject(
        String path,
        String method,
        String accessToken,
        String requestBody,
        String deviceId
    ) throws IOException, JSONException, PlannerWidgetHttpException {
        return new JSONObject(request(path, method, accessToken, requestBody, deviceId));
    }

    private String request(
        String path,
        String method,
        String accessToken,
        String requestBody,
        String deviceId
    ) throws IOException, PlannerWidgetHttpException {
        HttpURLConnection connection = (HttpURLConnection) new URL(
            config.apiBaseUrl + path
        ).openConnection();

        try {
            connection.setConnectTimeout(CONNECT_TIMEOUT_MILLIS);
            connection.setReadTimeout(READ_TIMEOUT_MILLIS);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", USER_AGENT);

            if (accessToken != null) {
                connection.setRequestProperty("Authorization", "Bearer " + accessToken);
                connection.setRequestProperty("X-Workspace-Id", config.workspaceId);
                connection.setRequestProperty("X-Client-Timezone", config.timeZone);
            }

            if (deviceId != null) {
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setRequestProperty("X-Auth-Device-Id", deviceId);
                connection.setRequestProperty("X-Auth-Token-Transport", "body");
            }

            if (requestBody != null) {
                byte[] bytes = requestBody.getBytes(StandardCharsets.UTF_8);

                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(bytes.length);

                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }
            }

            int status = connection.getResponseCode();
            InputStream responseStream = status >= 200 && status < 300
                ? connection.getInputStream()
                : connection.getErrorStream();
            String responseBody = responseStream == null ? "" : readBody(responseStream);

            if (status < 200 || status >= 300) {
                throw new PlannerWidgetHttpException(status);
            }

            if (responseBody.isEmpty()) {
                throw new IOException("Widget API returned an empty response.");
            }

            return responseBody;
        } finally {
            connection.disconnect();
        }
    }

    private static String readBody(InputStream input) throws IOException {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8 * 1024];
            int totalBytes = 0;
            int read;

            while ((read = stream.read(buffer)) != -1) {
                totalBytes += read;

                if (totalBytes > MAX_RESPONSE_BYTES) {
                    throw new IOException("Widget API response is too large.");
                }

                output.write(buffer, 0, read);
            }

            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
}

final class PlannerWidgetRemoteData {
    final JSONObject cleaningToday;
    final JSONArray spheres;
    final JSONObject selfCareDashboard;
    final JSONArray tasks;

    PlannerWidgetRemoteData(
        JSONArray tasks,
        JSONArray spheres,
        JSONObject selfCareDashboard,
        JSONObject cleaningToday
    ) {
        this.tasks = tasks;
        this.spheres = spheres;
        this.selfCareDashboard = selfCareDashboard;
        this.cleaningToday = cleaningToday;
    }
}

final class PlannerWidgetHttpException extends Exception {
    final int status;

    PlannerWidgetHttpException(int status) {
        super("Widget API request failed with status " + status + ".");
        this.status = status;
    }

    boolean isUnauthorized() {
        return status == HttpURLConnection.HTTP_UNAUTHORIZED;
    }

    boolean isRetryable() {
        return status == 408 || status == 425 || status == 429 || status >= 500;
    }
}
