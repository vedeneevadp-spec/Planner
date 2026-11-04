import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { TaskComposerDraft } from '@/features/task-create'

import { useWidgetTaskComposerDraft } from './useWidgetTaskComposerDraft'

function DraftProbe({
  enabled = true,
  onDraft,
}: {
  enabled?: boolean
  onDraft: (draft: TaskComposerDraft | null) => void
}) {
  const draft = useWidgetTaskComposerDraft(enabled)
  const location = useLocation()

  useEffect(() => {
    onDraft(draft)
  }, [draft, onDraft])

  return <output data-testid="search-params">{location.search}</output>
}

describe('useWidgetTaskComposerDraft', () => {
  afterEach(() => {
    cleanup()
  })

  it('creates one draft and removes only createTask from the URL', async () => {
    const onDraft = vi.fn()

    render(
      <MemoryRouter
        initialEntries={['/today?taskView=list&createTask=request-1&foo=bar']}
      >
        <DraftProbe onDraft={onDraft} />
      </MemoryRouter>,
    )

    expect(onDraft).toHaveBeenCalledWith({
      plannedDate: null,
      requestId: 'request-1',
    })
    await waitFor(() => {
      expect(screen.getByTestId('search-params')).toHaveTextContent(
        '?taskView=list&foo=bar',
      )
    })
    expect(onDraft).toHaveBeenCalledWith(null)
  })

  it('does not create a draft without the widget query parameter', () => {
    const onDraft = vi.fn()

    render(
      <MemoryRouter initialEntries={['/today?taskView=list']}>
        <DraftProbe onDraft={onDraft} />
      </MemoryRouter>,
    )

    expect(onDraft).toHaveBeenCalledWith(null)
    expect(screen.getByTestId('search-params')).toHaveTextContent(
      '?taskView=list',
    )
  })

  it('keeps the request in the URL until the planner can open the form', async () => {
    const onDraft = vi.fn()
    const view = render(
      <MemoryRouter initialEntries={['/today?createTask=waiting']}>
        <DraftProbe enabled={false} onDraft={onDraft} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('search-params')).toHaveTextContent(
      'createTask=waiting',
    )
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(onDraft).toHaveBeenCalledWith(null)

    view.rerender(
      <MemoryRouter initialEntries={['/today?createTask=waiting']}>
        <DraftProbe onDraft={onDraft} />
      </MemoryRouter>,
    )
    expect(onDraft).toHaveBeenCalledWith({
      plannedDate: null,
      requestId: 'waiting',
    })
    await waitFor(() =>
      expect(screen.getByTestId('search-params')).toBeEmptyDOMElement(),
    )
  })
})
