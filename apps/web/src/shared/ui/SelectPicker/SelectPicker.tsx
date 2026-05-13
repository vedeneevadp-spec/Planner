import { useId, useState } from 'react'

import { cx } from '@/shared/lib/classnames'

import styles from './SelectPicker.module.css'

export interface SelectPickerOption<Value extends string = string> {
  description?: string | undefined
  disabled?: boolean | undefined
  label: string
  value: Value
}

interface SelectPickerProps<Value extends string = string> {
  ariaLabel?: string | undefined
  className?: string | undefined
  disabled?: boolean | undefined
  label?: string | undefined
  options: Array<SelectPickerOption<Value>>
  placeholder?: string | undefined
  value: Value
  onChange: (value: Value) => void
}

export function SelectPicker<Value extends string = string>({
  ariaLabel,
  className,
  disabled = false,
  label,
  options,
  placeholder = 'Выбрать',
  value,
  onChange,
}: SelectPickerProps<Value>) {
  const labelId = useId()
  const [isOpen, setIsOpen] = useState(false)
  const selectedOption =
    options.find((option) => option.value === value) ?? null

  function selectValue(nextValue: Value) {
    onChange(nextValue)
    setIsOpen(false)
  }

  return (
    <div
      className={cx(styles.picker, className)}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget

        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setIsOpen(false)
        }
      }}
    >
      {label ? (
        <span id={labelId} className={styles.label}>
          {label}
        </span>
      ) : null}

      <button
        className={styles.trigger}
        type="button"
        disabled={disabled || options.length === 0}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-labelledby={label ? labelId : undefined}
        onClick={() => {
          setIsOpen((current) => !current)
        }}
      >
        <span className={styles.value}>
          <span className={cx(!selectedOption && styles.placeholder)}>
            {selectedOption?.label ?? placeholder}
          </span>
          {selectedOption?.description ? (
            <small>{selectedOption.description}</small>
          ) : null}
        </span>
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div className={styles.menu} role="listbox" tabIndex={-1}>
          {options.map((option) => (
            <button
              key={option.value}
              className={cx(
                styles.option,
                option.value === value && styles.optionActive,
              )}
              type="button"
              role="option"
              disabled={option.disabled}
              aria-selected={option.value === value}
              onClick={() => {
                selectValue(option.value)
              }}
            >
              <span className={styles.optionText}>
                <strong>{option.label}</strong>
                {option.description ? (
                  <small>{option.description}</small>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
