import { fireEvent, screen, within } from '@testing-library/react'

export function setTimeWithKeyboard(field: HTMLElement, time: string) {
  const [hour, minute] = time.split(':')
  fireEvent.click(field)
  const picker = within(screen.getByRole('dialog', { name: /^Выбор времени/ }))
  fireEvent.click(picker.getByRole('button', { name: 'Ввести с клавиатуры' }))
  fireEvent.change(picker.getByLabelText('Часы'), { target: { value: hour } })
  fireEvent.change(picker.getByLabelText('Минуты'), {
    target: { value: minute },
  })
  fireEvent.click(picker.getByRole('button', { name: 'Установить' }))
}
