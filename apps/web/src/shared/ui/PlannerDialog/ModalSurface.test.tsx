import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { afterEach, expect, it } from 'vitest'

import { ModalSurface } from './ModalSurface'

afterEach(cleanup)

function Example() {
  const [open, setOpen] = useState(false)
  const [nested, setNested] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open &&
        createPortal(
          <ModalSurface role="dialog" aria-modal="true" aria-label="Editor">
            <input aria-label="Title" />
            <button onClick={() => setNested(true)}>Nested</button>
            <button onClick={() => setOpen(false)}>Close</button>
          </ModalSurface>,
          document.body,
        )}
      {nested &&
        createPortal(
          <ModalSurface role="dialog" aria-modal="true" aria-label="Picker">
            <button onClick={() => setNested(false)}>Close picker</button>
          </ModalSurface>,
          document.body,
        )}
    </>
  )
}

it('contains forward/backward focus, makes the background inert and restores the opener', () => {
  const { container } = render(<Example />)
  const opener = screen.getByRole('button', { name: /^Open$/ })
  opener.focus()
  fireEvent.click(opener)
  const first = screen.getByRole('textbox', { name: 'Title' })
  const last = screen.getByRole('button', { name: /^Close$/ })
  expect(first).toHaveFocus()
  expect(container).toHaveAttribute('inert')
  last.focus()
  fireEvent.keyDown(last, { key: 'Tab' })
  expect(first).toHaveFocus()
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
  expect(last).toHaveFocus()
  opener.focus()
  expect(first).toHaveFocus()
  fireEvent.click(last)
  expect(opener).toHaveFocus()
  expect(container).not.toHaveAttribute('inert')
})

it('lets a nested portal own focus and restores the parent when it closes', () => {
  render(<Example />)
  fireEvent.click(screen.getByRole('button', { name: /^Open$/ }))
  const opener = screen.getByRole('button', { name: 'Nested' })
  opener.focus()
  fireEvent.click(opener)
  const close = screen.getByRole('button', { name: 'Close picker' })
  expect(close).toHaveFocus()
  fireEvent.keyDown(close, { key: 'Tab' })
  expect(close).toHaveFocus()
  fireEvent.click(close)
  expect(opener).toHaveFocus()
})

it('keeps the background inert when the parent is removed before its nested portal', () => {
  function IndependentDialogs({
    parent,
    child,
  }: {
    parent: boolean
    child: boolean
  }) {
    return (
      <>
        <button>Background</button>
        {parent &&
          createPortal(
            <ModalSurface role="dialog" aria-modal="true" aria-label="Parent">
              <button>Parent action</button>
            </ModalSurface>,
            document.body,
          )}
        {child &&
          createPortal(
            <ModalSurface role="dialog" aria-modal="true" aria-label="Child">
              <button>Child action</button>
            </ModalSurface>,
            document.body,
          )}
      </>
    )
  }
  const { container, rerender } = render(
    <IndependentDialogs parent child={false} />,
  )
  rerender(<IndependentDialogs parent child />)
  const childAction = screen.getByRole('button', { name: 'Child action' })
  expect(childAction).toHaveFocus()
  rerender(<IndependentDialogs parent={false} child />)
  expect(container).toHaveAttribute('inert')
  expect(childAction).toHaveFocus()
  rerender(<IndependentDialogs parent={false} child={false} />)
  expect(container).not.toHaveAttribute('inert')
})
