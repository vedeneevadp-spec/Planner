import { lazy, Suspense } from 'react'

import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'

const NativeAndroidImports = lazy(() =>
  import('./NativeAndroidImports').then((module) => ({
    default: module.NativeAndroidImports,
  })),
)

export function AndroidImports() {
  return isAndroidNativeRuntime() ? (
    <Suspense fallback={null}>
      <NativeAndroidImports />
    </Suspense>
  ) : null
}
