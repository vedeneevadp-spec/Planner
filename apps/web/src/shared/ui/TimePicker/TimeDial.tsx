import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'

import styles from './TimePicker.module.css'

export type ClockPart = 'hour' | 'minute'

// Distances from the centre, as fractions of the clock radius.
const outerRing = 0.8
const innerRing = 0.49
const positions = Array.from({ length: 12 }, (_, index) => index)

function hourAt(position: number, inner: boolean): number {
  if (inner) return position === 0 ? 0 : position + 12
  return position || 12
}

function point(angle: number, radius: number): CSSProperties {
  const radians = (angle * Math.PI) / 180
  return {
    left: `${50 + 50 * radius * Math.sin(radians)}%`,
    top: `${50 - 50 * radius * Math.cos(radians)}%`,
  }
}

export function TimeDial({
  part,
  value,
  onChange,
  onPick,
}: {
  part: ClockPart
  value: number
  onChange: (value: number) => void
  onPick: () => void
}) {
  const hours = part === 'hour'
  const count = hours ? 24 : 60
  const angle = hours ? (value % 12) * 30 : value * 6
  const radius = hours && (value === 0 || value > 12) ? innerRing : outerRing

  function selectAt(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - (bounds.left + bounds.width / 2)
    const y = event.clientY - (bounds.top + bounds.height / 2)
    const turn = (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1
    if (!hours) {
      onChange(Math.round(turn * 60) % 60)
      return
    }
    const position = Math.round(turn * 12) % 12
    const inner =
      Math.hypot(x, y) < (bounds.width * (outerRing + innerRing)) / 4
    onChange(hourAt(position, inner))
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    let next: number
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = (value + 1) % count
        break
      case 'ArrowDown':
      case 'ArrowLeft':
        next = (value + count - 1) % count
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = count - 1
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        onPick()
        return
      default:
        return
    }
    event.preventDefault()
    onChange(next)
  }

  function tick(index: number, inner: boolean) {
    const number = hours ? hourAt(index, inner) : index * 5
    const label =
      !hours || number === 0 ? String(number).padStart(2, '0') : number
    return (
      <span
        key={number}
        aria-hidden="true"
        className={styles.tick}
        data-inner={inner}
        data-selected={number === value}
        style={point(index * 30, inner ? innerRing : outerRing)}
      >
        {label}
      </span>
    )
  }

  return (
    <div
      className={styles.dial}
      role="slider"
      tabIndex={0}
      aria-label={hours ? 'Часы на циферблате' : 'Минуты на циферблате'}
      aria-valuemin={0}
      aria-valuemax={count - 1}
      aria-valuenow={value}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0 || !event.isPrimary) return
        event.currentTarget.setPointerCapture(event.pointerId)
        selectAt(event)
      }}
      onPointerMove={(event) => {
        if (
          event.isPrimary &&
          event.currentTarget.hasPointerCapture(event.pointerId)
        )
          selectAt(event)
      }}
      onPointerUp={(event) => {
        if (
          !event.isPrimary ||
          !event.currentTarget.hasPointerCapture(event.pointerId)
        )
          return
        selectAt(event)
        event.currentTarget.releasePointerCapture(event.pointerId)
        if (hours) onPick()
      }}
    >
      <span
        aria-hidden="true"
        className={styles.hand}
        style={{ height: `${radius * 50}%`, transform: `rotate(${angle}deg)` }}
      />
      <span
        aria-hidden="true"
        className={styles.selection}
        style={point(angle, radius)}
        data-between={!hours && value % 5 !== 0}
      />
      {positions.map((index) => tick(index, false))}
      {hours && positions.map((index) => tick(index, true))}
    </div>
  )
}
