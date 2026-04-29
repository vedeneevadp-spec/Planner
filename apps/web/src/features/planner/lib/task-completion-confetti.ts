import confetti from 'canvas-confetti'
import { useCallback } from 'react'

export function useTaskCompletionConfetti() {
  return useCallback(() => {
    void confetti({
      angle: 60,
      disableForReducedMotion: true,
      drift: 0.1,
      gravity: 1,
      origin: { x: 0.15, y: 0.72 },
      particleCount: 70,
      scalar: 0.95,
      spread: 68,
      startVelocity: 42,
      ticks: 220,
      zIndex: 2400,
    })

    void confetti({
      angle: 120,
      disableForReducedMotion: true,
      drift: -0.1,
      gravity: 1,
      origin: { x: 0.85, y: 0.72 },
      particleCount: 70,
      scalar: 0.95,
      spread: 68,
      startVelocity: 42,
      ticks: 220,
      zIndex: 2400,
    })
  }, [])
}
