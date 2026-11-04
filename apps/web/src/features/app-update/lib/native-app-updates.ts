import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'

export interface AndroidAppUpdate {
  versionCode: number
  versionName: string
  sizeBytes: number
  notes: string
}

export interface AndroidAppUpdateState {
  installedVersion: string
  installedBuild: number
  update: AndroidAppUpdate | null
  downloading: boolean
  downloaded: boolean
  progress: number
  dismissed: boolean
}

interface AppUpdatesPlugin {
  getState(): Promise<AndroidAppUpdateState>
  check(options: { force: boolean }): Promise<AndroidAppUpdateState>
  download(): Promise<AndroidAppUpdateState>
  install(): Promise<void>
  dismiss(): Promise<AndroidAppUpdateState>
  addListener(
    event: 'stateChange',
    listener: (state: AndroidAppUpdateState) => void,
  ): Promise<PluginListenerHandle>
}

export const nativeAppUpdates =
  registerPlugin<AppUpdatesPlugin>('PlannerAppUpdates')
