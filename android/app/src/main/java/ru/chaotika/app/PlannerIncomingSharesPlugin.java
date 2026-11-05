package ru.chaotika.app;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PlannerIncomingShares")
public class PlannerIncomingSharesPlugin extends Plugin {
    @PluginMethod
    public void readPendingShare(PluginCall call) {
        try {
            JSObject share = PlannerIncomingShareStore.QUEUE.peek(getContext());
            JSObject result = new JSObject();
            result.put("share", share == null ? JSObject.NULL : share);
            call.resolve(result);
        } catch (Exception exception) {
            call.reject("Could not open the shared draft.");
        }
    }

    @PluginMethod
    public void acknowledgeShare(PluginCall call) {
        String requestId = call.getString("requestId");
        if (requestId == null || requestId.isEmpty() || requestId.length() > 80) {
            call.reject("A shared draft identifier is required.");
            return;
        }
        try {
            PlannerIncomingShareStore.QUEUE.acknowledge(getContext(), requestId);
            call.resolve();
        } catch (Exception exception) {
            call.reject("Could not dismiss the shared draft.");
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        if (PlannerIncomingShareStore.accepts(intent)) notifyListeners("pendingShare", new JSObject());
    }
}
