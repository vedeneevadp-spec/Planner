import { SelectPicker } from '@/shared/ui/SelectPicker'

import {
  getReminderOffsetsFromSelectValue,
  getReminderSelectValue,
  SELF_CARE_REMINDER_CLEAR_VALUE,
  SELF_CARE_REMINDER_SELECT_OPTIONS,
} from './SelfCarePage.form-model'
import styles from './SelfCarePage.module.css'

export function SelfCareReminderOffsetsField({
  disabled,
  onChange,
  value,
}: {
  disabled?: boolean | undefined
  onChange: (value: number[]) => void
  value: readonly number[]
}) {
  const selectValue = getReminderSelectValue(value)

  function handleChange(nextValue: string[]): void {
    onChange(getReminderOffsetsFromSelectValue(nextValue))
  }

  return (
    <SelectPicker
      className={styles.selectField}
      label="Напомнить"
      multiple
      clearValue={SELF_CARE_REMINDER_CLEAR_VALUE}
      disabled={disabled}
      value={selectValue}
      options={SELF_CARE_REMINDER_SELECT_OPTIONS}
      onChange={handleChange}
    />
  )
}
