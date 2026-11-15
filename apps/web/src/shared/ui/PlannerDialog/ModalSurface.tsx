import { type HTMLAttributes, useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]'
const inertClaims = new WeakMap<
  HTMLElement,
  { count: number; wasInert: boolean }
>()

function claimInert(element: HTMLElement): () => void {
  const claim = inertClaims.get(element) ?? {
    count: 0,
    wasInert: element.hasAttribute('inert'),
  }
  claim.count += 1
  inertClaims.set(element, claim)
  element.setAttribute('inert', '')
  return () => {
    claim.count -= 1
    if (claim.count === 0) {
      if (!claim.wasInert) element.removeAttribute('inert')
      inertClaims.delete(element)
    }
  }
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[hidden],[inert]') &&
      getComputedStyle(element).display !== 'none' &&
      getComputedStyle(element).visibility !== 'hidden',
  )
}

function isTopModal(root: HTMLElement): boolean {
  const dialogs = [
    ...document.querySelectorAll<HTMLElement>(
      '[aria-modal="true"],dialog[open]',
    ),
  ].filter(
    (element) =>
      !element.closest('[hidden],[inert]') &&
      getComputedStyle(element).display !== 'none',
  )
  return dialogs.at(-1) === root
}

/** Focus/inert boundary for existing modal layouts, including nested portals. */
export function ModalSurface(props: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const previous = document.activeElement
    const releaseInert: Array<() => void> = []
    let branch: HTMLElement = root
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (
          sibling !== branch &&
          sibling instanceof HTMLElement &&
          !['SCRIPT', 'STYLE'].includes(sibling.tagName) &&
          !(
            sibling.matches('[aria-modal="true"],dialog[open]') &&
            Boolean(
              root.compareDocumentPosition(sibling) &
              Node.DOCUMENT_POSITION_FOLLOWING,
            )
          )
        ) {
          releaseInert.push(claimInert(sibling))
        }
      }
      if (branch.parentElement === document.body) break
      branch = branch.parentElement
    }
    const focusFirst = () => (focusableElements(root)[0] ?? root).focus()
    if (!root.contains(document.activeElement)) focusFirst()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !isTopModal(root)) return
      const elements = focusableElements(root)
      const first = elements[0]
      const last = elements.at(-1)
      if (!first || !last) {
        event.preventDefault()
        root.focus()
      } else if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === root)
      ) {
        event.preventDefault()
        last.focus()
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !root.contains(document.activeElement))
      ) {
        event.preventDefault()
        first.focus()
      }
    }
    const handleFocus = (event: FocusEvent) => {
      if (
        isTopModal(root) &&
        event.target instanceof Node &&
        !root.contains(event.target)
      )
        focusFirst()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('focusin', handleFocus)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('focusin', handleFocus)
      for (const release of releaseInert) release()
      if (
        previous instanceof HTMLElement &&
        previous.isConnected &&
        !previous.closest('[inert]')
      )
        previous.focus()
    }
  }, [])
  return <div {...props} ref={ref} tabIndex={props.tabIndex ?? -1} />
}
