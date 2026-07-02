export const SELF_CARE_ICON_PICKER_OPEN_DATA_KEY = 'selfCareIconPickerOpen'

export function isSelfCareIconPickerOpen(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.body.dataset[SELF_CARE_ICON_PICKER_OPEN_DATA_KEY] === 'true'
  )
}
