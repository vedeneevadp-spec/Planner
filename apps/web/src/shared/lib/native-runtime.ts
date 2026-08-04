import { Capacitor } from '@capacitor/core'

export function isAndroidNativeRuntime(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}
