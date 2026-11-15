import { useEffect, useId, useRef, useState } from 'react'

import { cx } from '@/shared/lib/classnames'

import styles from './SelectPicker.module.css'

export interface SelectPickerOption<Value extends string = string> {
  description?: string | undefined
  disabled?: boolean | undefined
  label: string
  value: Value
}

interface BaseSelectPickerProps<Value extends string = string> {
  ariaLabel?: string | undefined
  className?: string | undefined
  disabled?: boolean | undefined
  label?: string | undefined
  options: Array<SelectPickerOption<Value>>
  placeholder?: string | undefined
}

interface SingleSelectPickerProps<
  Value extends string = string,
> extends BaseSelectPickerProps<Value> {
  multiple?: false | undefined
  value: Value
  onChange: (value: Value) => void
}

interface MultiSelectPickerProps<
  Value extends string = string,
> extends BaseSelectPickerProps<Value> {
  clearValue?: Value | undefined
  closeOnSelect?: boolean | undefined
  multiple: true
  value: Value[]
  onChange: (value: Value[]) => void
}

type SelectPickerProps<Value extends string = string> =
  SingleSelectPickerProps<Value> | MultiSelectPickerProps<Value>

export function SelectPicker<Value extends string = string>(
  props: SelectPickerProps<Value>,
) {
  const {
    ariaLabel,
    className,
    disabled = false,
    label,
    options,
    placeholder = 'Выбрать',
  } = props
  const labelId = useId()
  const [isOpen, setIsOpen] = useState(false)
  const [focusedValue, setFocusedValue] = useState<string>('')
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!isOpen) return
    const menu = menuRef.current
    const selected = menu?.querySelector<HTMLButtonElement>(
      '[role="option"][aria-selected="true"]:not(:disabled)',
    )
    const first = menu?.querySelector<HTMLButtonElement>(
      '[role="option"]:not(:disabled)',
    )
    ;(selected ?? first)?.focus()
  }, [isOpen])
  const selectedOption = props.multiple
    ? null
    : (options.find((option) => option.value === props.value) ?? null)
  const selectedOptions = props.multiple
    ? options.filter(
        (option) =>
          option.value !== props.clearValue &&
          props.value.includes(option.value),
      )
    : []
  const clearOption =
    props.multiple && props.clearValue !== undefined
      ? (options.find((option) => option.value === props.clearValue) ?? null)
      : null
  const displayLabel = props.multiple
    ? selectedOptions.length > 0
      ? selectedOptions.map((option) => option.label).join(', ')
      : (clearOption?.label ?? placeholder)
    : (selectedOption?.label ?? placeholder)
  const displayDescription = props.multiple
    ? undefined
    : selectedOption?.description
  const hasDisplayValue = props.multiple
    ? selectedOptions.length > 0 || clearOption !== null
    : selectedOption !== null

  function selectValue(nextValue: Value) {
    if (props.multiple) {
      if (props.clearValue !== undefined && nextValue === props.clearValue) {
        props.onChange([])
        setIsOpen(false)
        triggerRef.current?.focus()
        return
      }

      const currentValues = props.value.filter(
        (item) => item !== props.clearValue,
      )
      const nextValues = currentValues.includes(nextValue)
        ? currentValues.filter((item) => item !== nextValue)
        : [...currentValues, nextValue]

      props.onChange(nextValues)

      if (props.closeOnSelect) {
        setIsOpen(false)
        triggerRef.current?.focus()
      }

      return
    }

    props.onChange(nextValue)
    setIsOpen(false)
    triggerRef.current?.focus()
  }

  function isOptionActive(option: SelectPickerOption<Value>) {
    if (props.multiple) {
      if (props.clearValue !== undefined && option.value === props.clearValue) {
        return props.value.length === 0
      }

      return props.value.includes(option.value)
    }

    return option.value === props.value
  }

  return (
    <div
      className={cx(styles.picker, className)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isOpen) {
          event.preventDefault()
          event.stopPropagation()
          setIsOpen(false)
          triggerRef.current?.focus()
          return
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        if (!isOpen) {
          setIsOpen(true)
          return
        }
        const available = [
          ...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
            '[role="option"]:not(:disabled)',
          ) ?? []),
        ]
        const current = available.findIndex(
          (element) => element === document.activeElement,
        )
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? available.length - 1
              : (current +
                  (event.key === 'ArrowDown' ? 1 : -1) +
                  available.length) %
                available.length
        available[next]?.focus()
      }}
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
        ref={triggerRef}
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
          <span className={cx(!hasDisplayValue && styles.placeholder)}>
            {displayLabel}
          </span>
          {displayDescription ? <small>{displayDescription}</small> : null}
        </span>
        <span className={styles.chevron} aria-hidden="true">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div
          ref={menuRef}
          className={styles.menu}
          role="listbox"
          aria-label={ariaLabel ?? label ?? placeholder}
          aria-multiselectable={props.multiple ? true : undefined}
          tabIndex={-1}
        >
          {options.map((option) => (
            <button
              key={option.value}
              className={cx(
                styles.option,
                isOptionActive(option) && styles.optionActive,
              )}
              type="button"
              role="option"
              tabIndex={focusedValue === option.value ? 0 : -1}
              onFocus={() => setFocusedValue(option.value)}
              disabled={option.disabled}
              aria-selected={isOptionActive(option)}
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
