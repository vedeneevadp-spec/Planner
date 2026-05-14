import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Sphere } from '../model/sphere.types'
import { SpherePicker } from './SpherePicker'

const spheres: Sphere[] = [
  {
    color: '#2f80ed',
    createdAt: '2026-04-20T08:00:00.000Z',
    deletedAt: null,
    description: '',
    icon: '🏠',
    id: 'sphere-home',
    isActive: true,
    isDefault: false,
    name: 'Дом',
    sortOrder: 10,
    updatedAt: '2026-04-20T08:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
  },
  {
    color: '#27ae60',
    createdAt: '2026-04-20T08:00:00.000Z',
    deletedAt: null,
    description: '',
    icon: '💼',
    id: 'sphere-work',
    isActive: true,
    isDefault: false,
    name: 'Работа',
    sortOrder: 20,
    updatedAt: '2026-04-20T08:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
  },
]

describe('SpherePicker', () => {
  afterEach(() => {
    cleanup()
  })

  it('opens options and selects a sphere', () => {
    const onChange = vi.fn()

    render(<SpherePicker spheres={spheres} value="" onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Без сферы/ }))
    const listbox = screen.getByRole('listbox')

    expect(
      within(listbox).getByRole('option', { name: /Без сферы/ }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(
      within(listbox).getByRole('option', { name: /Дом/ }),
    ).toHaveAttribute('aria-selected', 'false')

    fireEvent.click(within(listbox).getByRole('option', { name: /Работа/ }))

    expect(onChange).toHaveBeenCalledWith('sphere-work')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('marks the selected sphere and clears selection', () => {
    const onChange = vi.fn()

    render(
      <SpherePicker
        emptyLabel="Все сферы"
        spheres={spheres}
        value="sphere-home"
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
    render(<SpherePicker spheres={spheres} value="" onChange={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /Без сферы/ }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.blur(screen.getByText('Сфера'), { relatedTarget: document.body })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
