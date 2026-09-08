import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { PlannerProvider } from './PlannerProvider'

const clear = vi.hoisted(() => vi.fn())
vi.mock('../model/usePlannerState', () => ({
  usePlannerState: () => ({
    taskActionSnackbar: { id: 'notice', message: 'Изменения сохранены' },
    clearTaskActionSnackbar: clear,
  }),
}))
vi.mock('./PlannerTaskActionSnackbar', () => {
  throw new TypeError('Failed to fetch dynamically imported module')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('keeps the planner and saved-command notice available when an optional chunk fails offline', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  render(
    <PlannerProvider>
      <p>Задачи</p>
    </PlannerProvider>,
  )
  await waitFor(() => {
    expect(error).toHaveBeenCalled()
  })
  expect(screen.getByText('Задачи')).toBeVisible()
  expect(screen.getByRole('status')).toHaveTextContent('Изменения сохранены')
  fireEvent.click(screen.getByRole('button', { name: 'Закрыть уведомление' }))
  expect(clear).toHaveBeenCalledOnce()
})
