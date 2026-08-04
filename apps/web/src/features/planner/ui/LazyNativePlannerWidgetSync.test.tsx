import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isAndroidNativeRuntime: vi.fn<() => boolean>(),
}))

vi.mock('@/shared/lib/native-runtime', () => ({
  isAndroidNativeRuntime: () => mocks.isAndroidNativeRuntime(),
}))

vi.mock('./NativePlannerWidgetSync', () => ({
  NativePlannerWidgetSync: () => (
    <output data-testid="native-widget-sync">mounted</output>
  ),
}))

import { LazyNativePlannerWidgetSync } from './LazyNativePlannerWidgetSync'

describe('LazyNativePlannerWidgetSync', () => {
  beforeEach(() => {
    mocks.isAndroidNativeRuntime.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('does not mount the native widget bridge in the browser', () => {
    mocks.isAndroidNativeRuntime.mockReturnValue(false)

    render(<LazyNativePlannerWidgetSync />)

    expect(screen.queryByTestId('native-widget-sync')).not.toBeInTheDocument()
  })

  it('mounts the native widget bridge on Android', async () => {
    mocks.isAndroidNativeRuntime.mockReturnValue(true)

    render(<LazyNativePlannerWidgetSync />)

    expect(await screen.findByTestId('native-widget-sync')).toBeVisible()
  })
})
