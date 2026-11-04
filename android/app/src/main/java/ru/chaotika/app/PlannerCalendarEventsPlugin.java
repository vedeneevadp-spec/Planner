package ru.chaotika.app;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PlannerCalendarEvents")
public class PlannerCalendarEventsPlugin extends Plugin {
    @PluginMethod
    public void readPendingEvent(PluginCall call) {
        try {
            JSObject event = PlannerCalendarEventStore.peek(getContext());
            JSObject result = new JSObject();
            result.put("event", event == null ? JSObject.NULL : event);
            call.resolve(result);
        } catch (Exception exception) {
            call.reject("Could not open the incoming calendar draft.");
        }
    }

    @PluginMethod
    public void acknowledgeEvent(PluginCall call) {
        String requestId = call.getString("requestId");
        if (requestId == null || requestId.length() > 80) {
            call.reject("A calendar draft identifier is required.");
            return;
        }
        try {
            PlannerCalendarEventStore.acknowledge(getContext(), requestId);
            call.resolve();
        } catch (Exception exception) {
            call.reject("Could not dismiss the incoming calendar draft.");
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (PlannerCalendarEventStore.isCalendarInsert(intent)) {
            notifyListeners("pendingEvent", new JSObject());
        }
    }
}
