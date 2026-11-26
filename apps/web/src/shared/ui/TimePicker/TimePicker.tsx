import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'
import { getCurrentDeviceTime } from '@/shared/time/time.service'
import { ClockIcon, KeyboardIcon } from '@/shared/ui/Icon'

import { type ClockPart, TimeDial } from './TimeDial'
import styles from './TimePicker.module.css'

interface TimePickerProps {
  className?: string | undefined
  label: string
  value: string
  onChange: (time: string) => void
  disabled?: boolean
  required?: boolean
}

export function TimePicker({
  className,
  label,
  value,
  onChange,
  disabled,
  required,
}: TimePickerProps) {
  const labelId = useId()
  const [open, setOpen] = useState(false)

  if (isAndroidNativeRuntime()) {
    return (
      <label className={className}>
        <span>{label}</span>
        <input
          type="time"
          value={value}
          disabled={disabled}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    )
  }

  return (
    <>
      <label className={className}>
        <span id={labelId}>{label}</span>
        <button
          type="button"
          className={styles.trigger}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-description={value || 'Время не указано'}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={(event) => {
            event.currentTarget.focus()
            setOpen(true)
          }}
        >
          <bdi>{value || '––:––'}</bdi>
          <ClockIcon size={19} />
        </button>
      </label>
      {required && (
        <input
          type="time"
          className={styles.validationInput}
          aria-hidden="true"
          tabIndex={-1}
          required
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onInvalid={(event) => {
            event.preventDefault()
            const input = event.currentTarget
            const controls = input.form?.elements
            const firstInvalid =
              controls &&
              Array.from(controls).find(
                (field) =>
                  (field instanceof HTMLInputElement ||
                    field instanceof HTMLSelectElement ||
                    field instanceof HTMLTextAreaElement) &&
                  field.willValidate &&
                  !field.validity.valid,
              )
            if (!firstInvalid || firstInvalid === input) setOpen(true)
          }}
        />
      )}
      {open && !disabled && (
        <TimeDialog
          label={label}
          value={value}
          onClose={() => setOpen(false)}
          onSet={(time) => {
            onChange(time)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

function readTime(value: string) {
  const [hour = '00', minute = '00'] = (value || getCurrentDeviceTime()).split(
    ':',
  )
  return { hour, minute }
}

function TimeDialog({
  label,
  value,
  onSet,
  onClose,
}: {
  label: string
  value: string
  onSet: (time: string) => void
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const firstInput = useRef<HTMLInputElement>(null)
  const [part, setPart] = useState<ClockPart>('hour')
  const [keyboard, setKeyboard] = useState(false)
  const [draft, setDraft] = useState(() => readTime(value))
  const validHour = /^\d{1,2}$/u.test(draft.hour) && Number(draft.hour) < 24
  const validMinute =
    /^\d{1,2}$/u.test(draft.minute) && Number(draft.minute) < 60
  const valid = validHour && validMinute
  const hour = draft.hour.padStart(2, '0')
  const minute = draft.minute.padStart(2, '0')

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const opener = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    if (keyboard) firstInput.current?.focus()
  }, [keyboard])

  function confirm() {
    if (valid) onSet(`${hour}:${minute}`)
  }
  function change(partToChange: ClockPart, text: string) {
    setDraft((previous) => ({ ...previous, [partToChange]: text }))
  }
  function switchInputMode() {
    if (keyboard && !valid) {
      const saved = readTime(value)
      setDraft({
        hour: validHour ? hour : saved.hour,
        minute: validMinute ? minute : saved.minute,
      })
    }
    setKeyboard(!keyboard)
  }

  return createPortal(
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-label={`Выбор времени — ${label}`}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onClose()
        } else if (
          keyboard &&
          event.key === 'Enter' &&
          event.target instanceof HTMLInputElement
        ) {
          event.preventDefault()
          confirm()
        }
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={styles.panel}>
        {keyboard ? (
          <div className={styles.readout}>
            <label className={styles.numericField}>
              <input
                ref={firstInput}
                type="text"
                inputMode="numeric"
                maxLength={2}
                value={draft.hour}
                aria-invalid={!validHour}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => change('hour', event.target.value)}
              />
              <span>Часы</span>
            </label>
            <span aria-hidden="true">:</span>
            <label className={styles.numericField}>
              <input
                type="text"
                inputMode="numeric"
                maxLength={2}
                value={draft.minute}
                aria-invalid={!validMinute}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => change('minute', event.target.value)}
              />
              <span>Минуты</span>
            </label>
          </div>
        ) : (
          <>
            <div className={styles.readout}>
              <button
                type="button"
                aria-label={`Часы, ${hour}`}
                aria-pressed={part === 'hour'}
                onClick={() => setPart('hour')}
              >
                {hour}
              </button>
              <span aria-hidden="true">:</span>
              <button
                type="button"
                aria-label={`Минуты, ${minute}`}
                aria-pressed={part === 'minute'}
                onClick={() => setPart('minute')}
              >
                {minute}
              </button>
            </div>
            <TimeDial
              part={part}
              value={Number(draft[part])}
              onChange={(next) => change(part, String(next).padStart(2, '0'))}
              onPick={() => {
                if (part === 'hour') setPart('minute')
                else confirm()
              }}
            />
          </>
        )}
        {keyboard && !valid && (
          <p className={styles.error} role="status">
            Введите часы от 0 до 23 и минуты от 0 до 59.
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.mode}
            aria-label={
              keyboard ? 'Выбрать на циферблате' : 'Ввести с клавиатуры'
            }
            title={keyboard ? 'Циферблат' : 'Клавиатура'}
            onClick={switchInputMode}
          >
            {keyboard ? <ClockIcon size={23} /> : <KeyboardIcon size={23} />}
          </button>
          <button
            type="button"
            className={styles.set}
            disabled={!valid}
            onClick={confirm}
          >
            Установить
          </button>
          <button type="button" className={styles.cancel} onClick={onClose}>
            Отмена
          </button>
          {value && (
            <button
              type="button"
              className={styles.clear}
              aria-label="Удалить время"
              onClick={() => onSet('')}
            >
              Удалить
            </button>
          )}
        </div>
      </div>
    </dialog>,
    document.body,
  )
}
