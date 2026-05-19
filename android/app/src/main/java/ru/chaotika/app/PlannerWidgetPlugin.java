package ru.chaotika.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;

@CapacitorPlugin(name = "PlannerWidget")
public class PlannerWidgetPlugin extends Plugin {

    @PluginMethod
    public void consumePendingCompletedTasks(PluginCall call) {
        List<String> taskIds = PlannerWidgetStorage.consumePendingCompletedTaskIds(getContext());
        call.resolve(createTaskIdsResponse(taskIds));
    }

    @PluginMethod
    public void readPendingCompletedTasks(PluginCall call) {
        List<String> taskIds = PlannerWidgetStorage.readPendingCompletedTaskIds(getContext());
        call.resolve(createTaskIdsResponse(taskIds));
    }

    @PluginMethod
    public void ackPendingCompletedTasks(PluginCall call) {
        JSArray taskIdValues = call.getArray("taskIds", new JSArray());

        PlannerWidgetStorage.removePendingCompletedTaskIds(getContext(), toTaskIds(taskIdValues));
        call.resolve();
    }

    @PluginMethod
    public void consumePendingRoute(PluginCall call) {
        String route = PlannerWidgetStorage.consumePendingRoute(getContext());
        JSObject response = new JSObject();

        response.put("path", route == null ? JSObject.NULL : route);
        call.resolve(response);
    }

    @PluginMethod
    public void refresh(PluginCall call) {
        PlannerWidgetUpdateDispatcher.updateAllWidgets(getContext());
        call.resolve();
    }

    private static JSObject createTaskIdsResponse(List<String> taskIds) {
        JSONArray taskIdValues = new JSONArray();
        JSObject response = new JSObject();

        for (String taskId : taskIds) {
            taskIdValues.put(taskId);
        }

        response.put("taskIds", taskIdValues);

        return response;
    }

    private static List<String> toTaskIds(JSONArray taskIdValues) {
        List<String> taskIds = new ArrayList<>();

        if (taskIdValues == null) {
            return taskIds;
        }

        for (int index = 0; index < taskIdValues.length(); index += 1) {
            String taskId = taskIdValues.optString(index, "").trim();

            if (!taskId.isEmpty()) {
                taskIds.add(taskId);
            }
        }

        return taskIds;
    }
}
