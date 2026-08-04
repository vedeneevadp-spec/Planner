import { lazy, Suspense } from 'react'

import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'

const NativePlannerWidgetSyncComponent = lazy(() =>
  import('./NativePlannerWidgetSync').then((module) => ({
    default: module.NativePlannerWidgetSync,
  })),
)

export function LazyNativePlannerWidgetSync() {
  if (!isAndroidNativeRuntime()) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <NativePlannerWidgetSyncComponent />
    </Suspense>
  )
}
