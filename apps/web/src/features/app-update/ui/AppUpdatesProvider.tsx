import { lazy, type ReactNode, Suspense } from 'react'

import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'

const NativeAppUpdates = lazy(() =>
  import('./NativeAppUpdates').then((module) => ({
    default: module.NativeAppUpdates,
  })),
)

export function AppUpdatesProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      {isAndroidNativeRuntime() ? (
        <Suspense fallback={null}>
          <NativeAppUpdates />
        </Suspense>
      ) : null}
    </>
  )
}
