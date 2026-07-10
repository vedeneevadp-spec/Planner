import { generateUuidV7 } from '@planner/contracts'

const BROWSER_AUTH_DEVICE_ID_STORAGE_KEY = 'planner.auth.browserDeviceId'
const BROWSER_AUTH_DEVICE_ID_PATTERN =
  /^browser-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

interface BrowserAuthDeviceIdResolverOptions {
  createUuid?: (() => string) | undefined
  getStorage?: (() => Pick<Storage, 'getItem' | 'setItem'> | null) | undefined
}

export function createBrowserAuthDeviceIdResolver(
  options: BrowserAuthDeviceIdResolverOptions = {},
): () => string {
  const createUuid = options.createUuid ?? generateUuidV7
  const getStorage = options.getStorage ?? getBrowserLocalStorage
  let inMemoryDeviceId: string | null = null

  return () => {
    const storage = safelyGetStorage(getStorage)
    const storedDeviceId = normalizeBrowserAuthDeviceId(
      safelyReadDeviceId(storage),
    )

    if (storedDeviceId) {
      inMemoryDeviceId = storedDeviceId
      return storedDeviceId
    }

    inMemoryDeviceId ??= `browser-${createUuid()}`
    safelyWriteDeviceId(storage, inMemoryDeviceId)

    return inMemoryDeviceId
  }
}

const resolveBrowserAuthDeviceId = createBrowserAuthDeviceIdResolver()

export function getBrowserAuthDeviceId(): string {
  return resolveBrowserAuthDeviceId()
}

function getBrowserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage
}

function safelyGetStorage(
  getStorage: () => Pick<Storage, 'getItem' | 'setItem'> | null,
): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return getStorage()
  } catch {
    return null
  }
}

function safelyReadDeviceId(
  storage: Pick<Storage, 'getItem'> | null,
): string | null {
  try {
    return storage?.getItem(BROWSER_AUTH_DEVICE_ID_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

function safelyWriteDeviceId(
  storage: Pick<Storage, 'setItem'> | null,
  deviceId: string,
): void {
  try {
    storage?.setItem(BROWSER_AUTH_DEVICE_ID_STORAGE_KEY, deviceId)
  } catch {
    // The in-memory id still keeps retries stable for the current page runtime.
  }
}

function normalizeBrowserAuthDeviceId(
  deviceId: string | null | undefined,
): string | null {
  const normalizedDeviceId = deviceId?.trim()

  return normalizedDeviceId &&
    normalizedDeviceId.length <= 128 &&
    BROWSER_AUTH_DEVICE_ID_PATTERN.test(normalizedDeviceId)
    ? normalizedDeviceId
    : null
}
