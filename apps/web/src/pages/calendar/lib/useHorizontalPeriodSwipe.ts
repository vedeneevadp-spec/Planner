import {
  type MouseEventHandler,
  type PointerEventHandler,
  useCallback,
  useRef,
} from 'react'

const DEFAULT_THRESHOLD_PX = 50
const DEFAULT_VERTICAL_TOLERANCE_RATIO = 1.3
const DEFAULT_EDGE_GUARD_PX = 24
const NO_SWIPE_SELECTOR =
  'button,a,input,textarea,select,[role="button"],[data-no-swipe]'

interface SwipeState {
  captureTarget: Element
  pointerId: number
  startX: number
  startY: number
  wasHandled: boolean
}

interface UseHorizontalPeriodSwipeOptions {
  edgeGuardPx?: number | undefined
  enabled: boolean
  onSwipeLeft: () => void
  onSwipeRight: () => void
  thresholdPx?: number | undefined
  verticalToleranceRatio?: number | undefined
}

function isBlockedSwipeTarget(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
): boolean {
  if (!(target instanceof Element) || !(currentTarget instanceof Element)) {
    return false
  }

  const blockedTarget = target.closest(NO_SWIPE_SELECTOR)

  return (
    blockedTarget !== null &&
    currentTarget.contains(blockedTarget) &&
    !blockedTarget.matches('[data-period-swipe]:not([data-no-swipe])')
  )
}

function releasePointerCaptureIfNeeded(element: Element, pointerId: number) {
  if (!(element instanceof HTMLElement)) {
    return
  }

  try {
    if (
      typeof element.releasePointerCapture !== 'function' ||
      !element.hasPointerCapture(pointerId)
    ) {
      return
    }

    element.releasePointerCapture(pointerId)
  } catch {
    // Pointer capture support varies across WebView/jsdom implementations.
  }
}

export function useHorizontalPeriodSwipe({
  edgeGuardPx = DEFAULT_EDGE_GUARD_PX,
  enabled,
  onSwipeLeft,
  onSwipeRight,
  thresholdPx = DEFAULT_THRESHOLD_PX,
  verticalToleranceRatio = DEFAULT_VERTICAL_TOLERANCE_RATIO,
}: UseHorizontalPeriodSwipeOptions): {
  onClickCapture: MouseEventHandler<HTMLElement>
  onPointerCancel: PointerEventHandler<HTMLElement>
  onPointerDown: PointerEventHandler<HTMLElement>
  onPointerMove: PointerEventHandler<HTMLElement>
  onPointerUp: PointerEventHandler<HTMLElement>
} {
  const swipeStateRef = useRef<SwipeState | null>(null)
  const suppressClickRef = useRef(false)

  const resetSwipe = useCallback(() => {
    swipeStateRef.current = null
  }, [])

  const onPointerDown = useCallback<PointerEventHandler<HTMLElement>>(
    (event) => {
      suppressClickRef.current = false
      if (
        !enabled ||
        (event.pointerType === 'mouse' && event.button !== 0) ||
        event.clientX <= edgeGuardPx ||
        isBlockedSwipeTarget(event.target, event.currentTarget)
      ) {
        resetSwipe()
        return
      }

      // Capture on the time-slot button itself so a tap still activates it.
      const captureTarget =
        (event.target instanceof Element &&
          event.target.closest('[data-period-swipe]')) ||
        event.currentTarget
      swipeStateRef.current = {
        captureTarget,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        wasHandled: false,
      }

      try {
        captureTarget.setPointerCapture(event.pointerId)
      } catch {
        // Swipe recognition still works without pointer capture.
      }
    },
    [edgeGuardPx, enabled, resetSwipe],
  )

  const onPointerMove = useCallback<PointerEventHandler<HTMLElement>>(
    (event) => {
      const swipeState = swipeStateRef.current

      if (!swipeState || swipeState.pointerId !== event.pointerId) {
        return
      }

      if (!enabled) {
        releasePointerCaptureIfNeeded(swipeState.captureTarget, event.pointerId)
        resetSwipe()
      }
    },
    [enabled, resetSwipe],
  )

  const onPointerUp = useCallback<PointerEventHandler<HTMLElement>>(
    (event) => {
      const swipeState = swipeStateRef.current

      if (!swipeState || swipeState.pointerId !== event.pointerId) {
        return
      }

      const deltaX = event.clientX - swipeState.startX
      const deltaY = event.clientY - swipeState.startY
      const absDeltaX = Math.abs(deltaX)
      const absDeltaY = Math.abs(deltaY)
      suppressClickRef.current = Math.max(absDeltaX, absDeltaY) > 10
      const isHorizontalSwipe =
        absDeltaX >= thresholdPx &&
        absDeltaX > absDeltaY * verticalToleranceRatio

      if (isHorizontalSwipe && !swipeState.wasHandled && enabled) {
        swipeState.wasHandled = true

        if (deltaX < 0) {
          onSwipeLeft()
        } else {
          onSwipeRight()
        }
      }

      releasePointerCaptureIfNeeded(swipeState.captureTarget, event.pointerId)
      resetSwipe()
    },
    [
      enabled,
      onSwipeLeft,
      onSwipeRight,
      resetSwipe,
      thresholdPx,
      verticalToleranceRatio,
    ],
  )

  const onPointerCancel = useCallback<PointerEventHandler<HTMLElement>>(
    (event) => {
      releasePointerCaptureIfNeeded(
        swipeStateRef.current?.captureTarget ?? event.currentTarget,
        event.pointerId,
      )
      resetSwipe()
    },
    [resetSwipe],
  )

  const onClickCapture = useCallback<MouseEventHandler<HTMLElement>>(
    (event) => {
      if (suppressClickRef.current && event.detail !== 0) {
        event.preventDefault()
        event.stopPropagation()
        suppressClickRef.current = false
      }
    },
    [],
  )

  return {
    onClickCapture,
    onPointerCancel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
