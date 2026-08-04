import { lazy, Suspense } from 'react'

import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'

const NativePushRegistrationComponent = lazy(() =>
  import('./NativePushRegistration').then((module) => ({
    default: module.NativePushRegistration,
  })),
)

export function LazyNativePushRegistration() {
  if (!isAndroidNativeRuntime()) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <NativePushRegistrationComponent />
    </Suspense>
  )
}
