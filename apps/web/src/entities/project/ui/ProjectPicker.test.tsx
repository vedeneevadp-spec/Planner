import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Project } from '../model/project.types'
import { ProjectPicker } from './ProjectPicker'

const projects: Project[] = [
  {
    color: '#2f80ed',
    createdAt: '2026-04-20T08:00:00.000Z',
    deletedAt: null,
    description: '',
    icon: '🏠',
    id: 'project-home',
    status: 'active',
    title: 'Дом',
    updatedAt: '2026-04-20T08:00:00.000Z',
    version: 1,
    workspaceId: 'workspace-1',
  },
  {
    color: '#27ae60',
    createdAt: '2026-04-20T08:00:00.000Z',
    deletedAt: null,
    description: '',
    icon: '💼',
    id: 'project-work',
    status: 'active',
    title: 'Работа',
    updatedAt: '2026-04-20T08:00:00.000Z',
    version: 1,
    workspaceId: 'workspace-1',
  },
]

describe('ProjectPicker', () => {
  afterEach(() => {
    cleanup()
  })

  it('opens options and selects a project', () => {
    const onChange = vi.fn()

    render(<ProjectPicker projects={projects} value="" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Без сферы/ }))
    const listbox = screen.getByRole('listbox')

    expect(
      within(listbox).getByRole('option', { name: /Без сферы/ }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      within(listbox).getByRole('option', { name: /Дом/ }),
    ).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(within(listbox).getByRole('option', { name: /Работа/ }))

    expect(onChange).toHaveBeenCalledWith('project-work')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('marks the selected project and clears selection', () => {
    const onChange = vi.fn()

    render(
      <ProjectPicker
        emptyLabel="Все сферы"
        projects={projects}
        value="project-home"
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /Дом/ }))
    const listbox = screen.getByRole('listbox')

    expect(
      within(listbox).getByRole('option', { name: /Дом/ }),
    ).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(within(listbox).getByRole('option', { name: /Все сферы/ }))

    expect(onChange).toHaveBeenCalledWith('')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes the menu when focus leaves the picker', () => {
    render(<ProjectPicker projects={projects} value="" onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Без сферы/ }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.blur(screen.getByText('Сфера'), { relatedTarget: document.body })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
