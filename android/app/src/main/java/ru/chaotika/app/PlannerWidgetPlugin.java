package ru.chaotika.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "PlannerWidget")
public class PlannerWidgetPlugin extends Plugin {

    @PluginMethod
    public void consumePendingRoute(PluginCall call) {
        String route = PlannerWidgetStorage.consumePendingRoute(getContext());
        JSObject response = new JSObject();

        response.put("path", route == null ? JSObject.NULL : route);
        call.resolve(response);
    }

    @PluginMethod
    public void refresh(PluginCall call) {
        PlannerWidgetProvider.updateAllWidgets(getContext());
        call.resolve();
    }
}
