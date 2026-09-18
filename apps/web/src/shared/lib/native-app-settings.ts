import { registerPlugin } from '@capacitor/core'

import { isAndroidNativeRuntime } from './native-runtime'

interface PlannerAppSettingsPlugin {
  openSystemAppSettings: () => Promise<void>
}

const NativePlannerAppSettings =
  registerPlugin<PlannerAppSettingsPlugin>('PlannerAppSettings')

export async function openAndroidSystemAppSettings(): Promise<void> {
  if (!isAndroidNativeRuntime()) {
    return
  }

  await NativePlannerAppSettings.openSystemAppSettings()
}
