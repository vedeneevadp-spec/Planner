export const SELF_CARE_DIALOG_WARMUP_DELAY_MS = 1_500

type ModuleLoader<Module> = () => Promise<Module>

export function createRetryableModuleLoader<Module>(
  loadModule: ModuleLoader<Module>,
): ModuleLoader<Module> {
  let cachedAttempt: Promise<Module> | null = null

  return () => {
    if (cachedAttempt) {
      return cachedAttempt
    }

    const attempt = Promise.resolve().then(loadModule)
    const retryableAttempt = attempt.catch((error: unknown) => {
      if (cachedAttempt === retryableAttempt) {
        cachedAttempt = null
      }

      throw error
    })

    cachedAttempt = retryableAttempt
    return retryableAttempt
  }
}

export function createDialogModuleWarmup(
  loaders: ReadonlyArray<ModuleLoader<unknown>>,
) {
  return () =>
    Promise.allSettled(
      loaders.map((loadModule) => Promise.resolve().then(loadModule)),
    )
}

export const loadSelfCareFormDialogs = createRetryableModuleLoader(
  () => import('./SelfCarePage.dialogs'),
)

export const loadSelfCareActionDialogs = createRetryableModuleLoader(
  () => import('./SelfCarePage.action-dialogs'),
)

export const warmSelfCareDialogModules = createDialogModuleWarmup([
  loadSelfCareFormDialogs,
  loadSelfCareActionDialogs,
])

export function startSelfCareDialogWarmup(
  warmup: () => Promise<unknown> = warmSelfCareDialogModules,
): () => void {
  let timeoutId: number | null = null

  function scheduleWarmup(): void {
    if (!navigator.onLine || timeoutId !== null) {
      return
    }

    timeoutId = window.setTimeout(() => {
      timeoutId = null
      void warmup()
    }, SELF_CARE_DIALOG_WARMUP_DELAY_MS)
  }

  scheduleWarmup()
  window.addEventListener('online', scheduleWarmup)

  return () => {
    window.removeEventListener('online', scheduleWarmup)
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId)
    }
  }
}
