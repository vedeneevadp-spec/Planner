import { lazy, Suspense } from 'react'

const NativePlannerWidgetSyncComponent = lazy(() =>
  import('./NativePlannerWidgetSync').then((module) => ({
    default: module.NativePlannerWidgetSync,
  })),
)

export function LazyNativePlannerWidgetSync() {
  return (
    <Suspense fallback={null}>
      <NativePlannerWidgetSyncComponent />
    </Suspense>
  )
}
