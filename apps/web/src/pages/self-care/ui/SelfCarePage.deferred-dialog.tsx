import {
  type ComponentProps,
  type ComponentType,
  useEffect,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

import { CloseIcon } from '@/shared/ui/Icon'
import { PageStateView } from '@/shared/ui/PageState'

import type {
  SelfCareCompletionEditDialog as SelfCareCompletionEditDialogType,
  SelfCareCourseRestartDialog as SelfCareCourseRestartDialogType,
  SelfCareExerciseDialog as SelfCareExerciseDialogType,
  SelfCareMeasurementDialog as SelfCareMeasurementDialogType,
  SelfCareScheduleDialog as SelfCareScheduleDialogType,
} from './SelfCarePage.action-dialogs'
import {
  loadSelfCareActionDialogs,
  loadSelfCareFormDialogs,
} from './SelfCarePage.dialog-loader'
import type {
  SelfCareCreateDialog as SelfCareCreateDialogType,
  SelfCareEditDialog as SelfCareEditDialogType,
} from './SelfCarePage.dialogs'
import styles from './SelfCarePage.module.css'

interface DeferredDialogBaseProps {
  onClose: () => void
}

interface DeferredDialogCopy {
  loadingTitle: string
  unavailableTitle: string
}

type SelfCareCreateDialogProps = ComponentProps<typeof SelfCareCreateDialogType>
type SelfCareEditDialogProps = ComponentProps<typeof SelfCareEditDialogType>
type SelfCareScheduleDialogProps = ComponentProps<
  typeof SelfCareScheduleDialogType
>
type SelfCareMeasurementDialogProps = ComponentProps<
  typeof SelfCareMeasurementDialogType
>
type SelfCareExerciseDialogProps = ComponentProps<
  typeof SelfCareExerciseDialogType
>
type SelfCareCompletionEditDialogProps = ComponentProps<
  typeof SelfCareCompletionEditDialogType
>
type SelfCareCourseRestartDialogProps = ComponentProps<
  typeof SelfCareCourseRestartDialogType
>

const loadSelfCareCreateDialog = () =>
  loadSelfCareFormDialogs().then((module) => ({
    default: module.SelfCareCreateDialog,
  }))

const loadSelfCareEditDialog = () =>
  loadSelfCareFormDialogs().then((module) => ({
    default: module.SelfCareEditDialog,
  }))

const loadSelfCareScheduleDialog = () =>
  loadSelfCareActionDialogs().then((module) => ({
    default: module.SelfCareScheduleDialog,
  }))

const loadSelfCareMeasurementDialog = () =>
  loadSelfCareActionDialogs().then((module) => ({
    default: module.SelfCareMeasurementDialog,
  }))

const loadSelfCareExerciseDialog = () =>
  loadSelfCareActionDialogs().then((module) => ({
    default: module.SelfCareExerciseDialog,
  }))

const loadSelfCareCompletionEditDialog = () =>
  loadSelfCareActionDialogs().then((module) => ({
    default: module.SelfCareCompletionEditDialog,
  }))

const loadSelfCareCourseRestartDialog = () =>
  loadSelfCareActionDialogs().then((module) => ({
    default: module.SelfCareCourseRestartDialog,
  }))

export function DeferredSelfCareCreateDialog(props: SelfCareCreateDialogProps) {
  return (
    <DeferredSelfCareDialog
      copy={{
        loadingTitle: 'Открываем добавление заботы',
        unavailableTitle: 'Не удалось открыть добавление заботы',
      }}
      dialogProps={props}
      loadDialog={loadSelfCareCreateDialog}
    />
  )
}

export function DeferredSelfCareEditDialog(props: SelfCareEditDialogProps) {
  return (
    <DeferredSelfCareDialog
      copy={{
        loadingTitle: 'Открываем редактирование заботы',
        unavailableTitle: 'Не удалось открыть редактирование заботы',
      }}
      dialogProps={props}
      loadDialog={loadSelfCareEditDialog}
    />
  )
}

export function DeferredSelfCareScheduleDialog(
  props: SelfCareScheduleDialogProps,
) {
  return (
    <DeferredSelfCareDialog
      copy={{
        loadingTitle: 'Открываем расписание',
        unavailableTitle: 'Не удалось открыть расписание',
      }}
      dialogProps={props}
      loadDialog={loadSelfCareScheduleDialog}
    />
  )
}

export function DeferredSelfCareMeasurementDialog(
  props: SelfCareMeasurementDialogProps,
) {
  return (
    <DeferredSelfCareDialog
      copy={{
        loadingTitle: 'Открываем отметку результата',
        unavailableTitle: 'Не удалось открыть отметку результата',
      }}
      dialogProps={props}
      loadDialog={loadSelfCareMeasurementDialog}
    />
  )
}

export function DeferredSelfCareExerciseDialog(
  props: SelfCareExerciseDialogProps,
) {
  return (
    <DeferredSelfCareDialog
      copy={{
        loadingTitle: 'Открываем отметку занятия',
        unavailableTitle: 'Не удалось открыть отметку занятия',
      }}
      dialogProps={props}
      loadDialog={loadSelfCareExerciseDialog}
    />
  )
}

export function DeferredSelfCareCompletionEditDialog(
  props: SelfCareCompletionEditDialogProps,
) {
  return (
    <DeferredSelfCareDialog
      copy={{
        loadingTitle: 'Открываем редактирование записи',
        unavailableTitle: 'Не удалось открыть редактирование записи',
      }}
      dialogProps={props}
      loadDialog={loadSelfCareCompletionEditDialog}
    />
  )
}

export function DeferredSelfCareCourseRestartDialog(
  props: SelfCareCourseRestartDialogProps,
) {
  return (
    <DeferredSelfCareDialog
      copy={{
        loadingTitle: 'Открываем повтор курса',
        unavailableTitle: 'Не удалось открыть повтор курса',
      }}
      dialogProps={props}
      loadDialog={loadSelfCareCourseRestartDialog}
    />
  )
}

interface DeferredDialogState<Props> {
  Dialog: ComponentType<Props> | null
  error: unknown
}

export function DeferredSelfCareDialog<Props extends DeferredDialogBaseProps>({
  copy,
  dialogProps,
  loadDialog,
}: {
  copy: DeferredDialogCopy
  dialogProps: Props
  loadDialog: () => Promise<{ default: ComponentType<Props> }>
}) {
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadState, setLoadState] = useState<DeferredDialogState<Props>>({
    Dialog: null,
    error: null,
  })

  useEffect(() => {
    let isCurrentAttempt = true

    void loadDialog().then(
      (module) => {
        if (isCurrentAttempt) {
          setLoadState({ Dialog: module.default, error: null })
        }
      },
      (error: unknown) => {
        if (isCurrentAttempt) {
          console.warn('Failed to load a self-care dialog.', error)
          setLoadState({ Dialog: null, error })
        }
      },
    )

    return () => {
      isCurrentAttempt = false
    }
  }, [loadAttempt, loadDialog])

  if (loadState.error) {
    return (
      <SelfCareDialogLoadState
        copy={copy}
        kind="error"
        onClose={dialogProps.onClose}
        onRetry={() => {
          setLoadState({ Dialog: null, error: null })
          setLoadAttempt((attempt) => attempt + 1)
        }}
      />
    )
  }

  const LoadedDialog = loadState.Dialog

  if (!LoadedDialog) {
    return (
      <SelfCareDialogLoadState
        copy={copy}
        kind="loading"
        onClose={dialogProps.onClose}
      />
    )
  }

  return <LoadedDialog {...dialogProps} />
}

function SelfCareDialogLoadState({
  copy,
  kind,
  onClose,
  onRetry,
}: {
  copy: DeferredDialogCopy
  kind: 'error' | 'loading'
  onClose: () => void
  onRetry?: (() => void) | undefined
}) {
  if (typeof document === 'undefined') {
    return null
  }

  const isOffline =
    kind === 'error' && typeof navigator !== 'undefined' && !navigator.onLine
  const title = kind === 'loading' ? copy.loadingTitle : copy.unavailableTitle

  return createPortal(
    <div
      aria-label={title}
      aria-modal="true"
      className={styles.modalOverlay}
      role="dialog"
    >
      <button
        aria-label="Закрыть окно"
        className={styles.backdropButton}
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />

      <section className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <div />
          <button
            aria-label="Закрыть окно"
            className={styles.closeButton}
            onClick={onClose}
            type="button"
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        <PageStateView
          action={
            kind === 'error' && onRetry
              ? { label: 'Повторить', onClick: onRetry }
              : undefined
          }
          description={
            isOffline
              ? 'Это окно ещё не сохранено на устройстве. Подключитесь к интернету и повторите.'
              : kind === 'error'
                ? 'Данные не изменились. Проверьте подключение и попробуйте снова.'
                : undefined
          }
          kind={isOffline ? 'offline' : kind}
          skeletonVariant="detail"
          title={title}
        />
      </section>
    </div>,
    document.body,
  )
}
