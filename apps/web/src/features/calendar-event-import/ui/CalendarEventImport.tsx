import { lazy, Suspense } from 'react'

import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'

const NativeCalendarEventImport = lazy(() =>
  import('./NativeCalendarEventImport').then((module) => ({
    default: module.NativeCalendarEventImport,
  })),
)

export function CalendarEventImport() {
  return isAndroidNativeRuntime() ? (
    <Suspense fallback={null}>
      <NativeCalendarEventImport />
    </Suspense>
  ) : null
}
