package ru.chaotika.app;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import org.json.JSONException;
import org.json.JSONObject;

final class BackendSpeechToTextService implements RecordedSpeechToTextProvider {

    private static final int CONNECT_TIMEOUT_MS = 8000;
    private static final int READ_TIMEOUT_MS = 12000;
    private static final int HTTP_TOO_MANY_REQUESTS = 429;

    private final android.content.Context context;

    BackendSpeechToTextService(android.content.Context context) {
        this.context = context.getApplicationContext();
    }

    @Override
    public boolean isAvailable() {
        VoiceAssistantApiConfig config = PlannerVoiceAssistantStorage.readApiConfig(context);

        return config != null && config.isUsable();
    }

    @Override
    public SttResult transcribe(CommandAudio audio, SttSource source) throws SttException {
        VoiceAssistantApiConfig config = PlannerVoiceAssistantStorage.readApiConfig(context);

        if (config == null || !config.isUsable()) {
            throw new SttException(
                SttError.SERVER_STT_UNAVAILABLE,
                "Backend endpoint для STT не настроен."
            );
        }

        HttpURLConnection connection = null;

        try {
            URL endpoint = new URL(config.apiBaseUrl + "/api/voice/command");
            connection = (HttpURLConnection) endpoint.openConnection();
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setDoOutput(true);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "audio/l16");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("x-workspace-id", config.workspaceId);
            connection.setRequestProperty("x-audio-sample-rate", String.valueOf(audio.sampleRateHertz));
            connection.setRequestProperty("x-audio-channel-count", String.valueOf(audio.channelCount));
            connection.setRequestProperty("x-audio-bits-per-sample", String.valueOf(audio.bitsPerSample));
            connection.setRequestProperty("x-audio-byte-order", audio.byteOrder);
            connection.setRequestProperty("x-audio-encoding", audio.encoding);
            connection.setRequestProperty("x-audio-duration-ms", String.valueOf(audio.durationMs));
            connection.setRequestProperty("x-stt-source", toBackendSource(source));

            if (config.accessToken != null) {
                connection.setRequestProperty("Authorization", "Bearer " + config.accessToken);
            } else if (config.actorUserId != null) {
                connection.setRequestProperty("x-actor-user-id", config.actorUserId);
            }

            try (BufferedOutputStream output = new BufferedOutputStream(connection.getOutputStream())) {
                output.write(audio.pcm16le);
            }

            int status = connection.getResponseCode();
            String body = readResponseBody(connection, status);

            if (status == HTTP_TOO_MANY_REQUESTS) {
                throw new SttException(SttError.RATE_LIMITED, "Слишком много голосовых команд.");
            }

            if (status < 200 || status >= 300) {
                throw mapBackendError(status, body);
            }

            JSONObject response = new JSONObject(body);
            String transcript = response.optString("transcript", "").trim();

            if (transcript.isEmpty()) {
                throw new SttException(SttError.NO_SPEECH, "Команда не распознана.");
            }

            JSONObject stt = response.optJSONObject("stt");
            JSONObject intent = response.optJSONObject("intent");
            double confidence = stt != null && !stt.isNull("confidence") ? stt.optDouble("confidence", 1d) : 1d;

            return new SttResult(
                transcript,
                confidence,
                SttProvider.BACKEND,
                source,
                audio.durationMs,
                intent != null ? intent.toString() : null
            );
        } catch (SocketTimeoutException error) {
            throw new SttException(SttError.NETWORK_ERROR, "STT backend не ответил вовремя.", error);
        } catch (IOException error) {
            throw new SttException(SttError.NETWORK_ERROR, "Не удалось отправить аудио на backend.", error);
        } catch (JSONException error) {
            throw new SttException(SttError.SERVER_STT_UNAVAILABLE, "Backend вернул некорректный STT ответ.", error);
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static String toBackendSource(SttSource source) {
        if (source == SttSource.ANDROID_PUSH_TO_TALK) {
            return "android_push_to_talk";
        }

        if (source == SttSource.LOCAL_FALLBACK) {
            return "local_fallback";
        }

        if (source == SttSource.TEST_STUB) {
            return "test_stub";
        }

        return "android_short_clip";
    }

    private static SttException mapBackendError(int status, String body) {
        SttError code = parseErrorCode(body);

        if (code != null) {
            return new SttException(code, "Backend отклонил STT запрос.");
        }

        if (status == HttpURLConnection.HTTP_UNSUPPORTED_TYPE) {
            return new SttException(SttError.UNSUPPORTED_AUDIO_FORMAT, "Неподдерживаемый формат аудио.");
        }

        if (status == HttpURLConnection.HTTP_ENTITY_TOO_LARGE) {
            return new SttException(SttError.TOO_LONG, "Команда слишком длинная.");
        }

        if (status == HttpURLConnection.HTTP_UNAUTHORIZED || status == HttpURLConnection.HTTP_FORBIDDEN) {
            return new SttException(SttError.SERVER_STT_UNAVAILABLE, "Нет доступа к backend STT.");
        }

        return new SttException(SttError.SERVER_STT_UNAVAILABLE, "Backend STT недоступен.");
    }

    private static SttError parseErrorCode(String body) {
        try {
            JSONObject response = new JSONObject(body);
            JSONObject error = response.optJSONObject("error");
            String rawCode = error != null ? error.optString("code", "") : "";

            if (rawCode.isEmpty()) {
                return null;
            }

            return SttError.valueOf(rawCode.trim().toUpperCase(java.util.Locale.US));
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String readResponseBody(HttpURLConnection connection, int status) throws IOException {
        java.io.InputStream responseStream = status >= 200 && status < 300
            ? connection.getInputStream()
            : connection.getErrorStream();

        if (responseStream == null) {
            return "";
        }

        BufferedInputStream input = new BufferedInputStream(responseStream);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];

        try (input) {
            int read;

            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
        }

        return output.toString(java.nio.charset.StandardCharsets.UTF_8.name());
    }
}
