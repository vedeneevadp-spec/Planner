import { lazy, type ReactNode, Suspense } from 'react'

import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'

const NativeAppUpdates =
  import.meta.env.VITE_ANDROID_DISTRIBUTION === 'googlePlay'
    ? null
    : lazy(() =>
        import('./NativeAppUpdates').then((module) => ({
          default: module.NativeAppUpdates,
        })),
      )

export function AppUpdatesProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {NativeAppUpdates && isAndroidNativeRuntime() ? (
        <Suspense fallback={null}>
          <NativeAppUpdates />
        </Suspense>
      ) : null}
    </>
  )
}
