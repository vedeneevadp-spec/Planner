import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { IconChoicePicker } from './IconChoicePicker'

describe('IconChoicePicker', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows uploaded icons before built-in svg icons', () => {
    render(
      <IconChoicePicker
        allowEmpty={false}
        label="Иконка"
        showEmojiChoices={false}
        uploadedIcons={[
          {
            id: 'uploaded-1',
            label: 'Моя иконка',
            value: 'https://chaotika.ru/api/v1/icon-assets/uploaded-1.png',
          },
        ]}
        value=""
        onChange={() => {}}
      />,
    )

    const [firstButton] = screen.getAllByRole('button')

    expect(firstButton).toHaveAttribute('aria-label', 'Моя иконка')
  })
})
