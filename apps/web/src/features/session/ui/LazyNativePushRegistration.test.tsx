import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isAndroidNativeRuntime: vi.fn<() => boolean>(),
}))

vi.mock('@/shared/lib/native-runtime', () => ({
  isAndroidNativeRuntime: () => mocks.isAndroidNativeRuntime(),
}))

vi.mock('./NativePushRegistration', () => ({
  NativePushRegistration: () => (
    <output data-testid="native-push-registration">mounted</output>
  ),
}))

import { LazyNativePushRegistration } from './LazyNativePushRegistration'

describe('LazyNativePushRegistration', () => {
  beforeEach(() => {
    mocks.isAndroidNativeRuntime.mockReset()
  })

  afterEach(() => {
    cleanup()
  })

  it('does not mount the native push bridge in the browser', () => {
    mocks.isAndroidNativeRuntime.mockReturnValue(false)

    render(<LazyNativePushRegistration />)

    expect(
      screen.queryByTestId('native-push-registration'),
    ).not.toBeInTheDocument()
  })

  it('mounts the native push bridge on Android', async () => {
    mocks.isAndroidNativeRuntime.mockReturnValue(true)

    render(<LazyNativePushRegistration />)

    expect(await screen.findByTestId('native-push-registration')).toBeVisible()
  })
})
