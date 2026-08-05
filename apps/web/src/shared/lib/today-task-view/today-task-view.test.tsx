import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getStoredTodayTaskView,
  getTodayTaskViewFromSearchParams,
  setStoredTodayTaskView,
  useTodayTaskView,
} from './today-task-view'

describe('today-task-view', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it.each([
    ['', null],
    ['taskView=cards', 'cards'],
    ['taskView=unknown', null],
    ['taskView=LIST', null],
    ['taskView=list', 'list'],
  ] as const)('parses task view from %s', (query, expected) => {
    expect(getTodayTaskViewFromSearchParams(new URLSearchParams(query))).toBe(
      expected,
    )
  })

  it('uses cards by default', () => {
    const { result } = renderHook(() => useTodayTaskView(new URLSearchParams()))

    expect(result.current).toBe('cards')
    expect(getStoredTodayTaskView()).toBe('cards')
  })

  it('keeps the stored view across unmounts', () => {
    setStoredTodayTaskView('list')

    const first = renderHook(() => useTodayTaskView(new URLSearchParams()))

    expect(first.result.current).toBe('list')
    first.unmount()

    const second = renderHook(() => useTodayTaskView(new URLSearchParams()))

    expect(second.result.current).toBe('list')
  })

  it('synchronizes a same-tab preference update', () => {
    const { result } = renderHook(() => useTodayTaskView(new URLSearchParams()))

    act(() => {
      setStoredTodayTaskView('list')
    })

    expect(result.current).toBe('list')
  })

  it('gives an explicit URL view priority and stores it', async () => {
    setStoredTodayTaskView('list')

    const { result } = renderHook(() =>
      useTodayTaskView(new URLSearchParams('taskView=cards')),
    )

    expect(result.current).toBe('cards')
    await waitFor(() => {
      expect(getStoredTodayTaskView()).toBe('cards')
    })
  })

  it('falls back to the stored view for an invalid URL value', () => {
    setStoredTodayTaskView('list')

    const { result } = renderHook(() =>
      useTodayTaskView(new URLSearchParams('taskView=unknown')),
    )

    expect(result.current).toBe('list')
  })

  it('falls back safely when local storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage is blocked')
    })

    expect(getStoredTodayTaskView()).toBe('cards')
  })
})
