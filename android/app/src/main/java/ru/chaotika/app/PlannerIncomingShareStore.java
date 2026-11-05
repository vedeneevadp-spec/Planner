package ru.chaotika.app;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.JSObject;

final class PlannerIncomingShareStore {
    static final PlannerIncomingDraftQueue QUEUE = new PlannerIncomingDraftQueue(
        "planner.share.pending.v1", "planner_incoming_shares"
    );

    private PlannerIncomingShareStore() {}

    static boolean accepts(Intent intent) {
        return intent != null
            && Intent.ACTION_SEND.equals(intent.getAction())
            && "text/plain".equalsIgnoreCase(intent.getType())
            && (intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0;
    }

    static JSObject parse(Intent intent) {
        if (!accepts(intent)) return null;
        try {
            if (intent.hasExtra(Intent.EXTRA_STREAM)) return null;
            Bundle extras = intent.getExtras();
            CharSequence incoming = extraText(extras, Intent.EXTRA_TEXT);
            if (incoming == null) {
                ClipData clip = intent.getClipData();
                // Only inline text. coerceToText() could open an external content URI.
                if (clip != null && clip.getItemCount() == 1) incoming = clip.getItemAt(0).getText();
            }
            String text = boundedText(incoming, 10000);
            if (text.isEmpty()) return null;
            String subject = boundedText(extraText(extras, Intent.EXTRA_SUBJECT), 240);
            if (subject.isEmpty()) subject = boundedText(extraText(extras, Intent.EXTRA_TITLE), 240);
            JSObject share = new JSObject();
            share.put("requestId", PlannerUuidV7.generate());
            share.put("text", text);
            share.put("subject", subject);
            return share;
        } catch (RuntimeException exception) {
            // Other apps supply the parcel. Never log shared text or link contents.
            return null;
        }
    }

    static void receive(Context context, Intent intent) {
        JSObject share = parse(intent);
        if (share != null) QUEUE.add(context, share);
    }

    private static CharSequence extraText(Bundle extras, String key) {
        Object value = extras == null ? null : extras.get(key);
        return value instanceof CharSequence ? (CharSequence) value : null;
    }

    private static String boundedText(CharSequence value, int limit) {
        if (value == null) return "";
        String text = value.toString().trim();
        if (text.length() <= limit) return text;
        int end = Character.isHighSurrogate(text.charAt(limit - 1)) ? limit - 1 : limit;
        return text.substring(0, end);
    }
}
