import {
  type AuthStorage,
  clearNativeSessionStorage,
  createNativeSessionStorage,
  isNativeSessionPersistenceRuntime,
} from './native-session-storage'

const AUTH_SESSION_STORAGE_KEY = 'planner.auth.session'
const REMEMBER_SESSION_STORAGE_KEY = 'planner.rememberSession'
const inMemoryAuthStorage = new Map<string, string>()
const nativeSessionStorage = createNativeSessionStorage()

export interface StoredAuthSession {
  accessToken: string
  email: string
  expiresAt: string
  refreshToken?: string | undefined
  userId: string
}

export function getRememberSessionPreference(): boolean {
  if (isNativeSessionPersistenceRuntime()) {
    return true
  }

  if (typeof window === 'undefined') {
    return true
  }

  try {
    return window.localStorage.getItem(REMEMBER_SESSION_STORAGE_KEY) !== 'false'
  } catch {
    return true
  }
}

export function setRememberSessionPreference(remember: boolean): void {
  if (isNativeSessionPersistenceRuntime()) {
    return
  }

  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      REMEMBER_SESSION_STORAGE_KEY,
      remember ? 'true' : 'false',
    )
  } catch (error) {
    console.error('Failed to persist session preference.', error)
  }

  void clearStoredAuthSession(remember ? 'session' : 'local')
}

export async function readStoredAuthSession(): Promise<StoredAuthSession | null> {
  const rawSession = await getActiveAuthStorage().getItem(
    AUTH_SESSION_STORAGE_KEY,
  )

  if (!rawSession) {
    return null
  }

  try {
    const parsedSession = JSON.parse(rawSession) as unknown

    if (isStoredAuthSession(parsedSession)) {
      return parsedSession
    }
  } catch (error) {
    console.error('Failed to parse stored auth session.', error)
  }

  return null
}

export async function writeStoredAuthSession(
  session: StoredAuthSession,
): Promise<void> {
  await getActiveAuthStorage().setItem(
    AUTH_SESSION_STORAGE_KEY,
    JSON.stringify(session),
  )
}

export async function clearStoredAuthSession(
  scope: 'all' | 'local' | 'session' = 'all',
): Promise<void> {
  if (isNativeSessionPersistenceRuntime()) {
    await clearNativeSessionStorage([AUTH_SESSION_STORAGE_KEY])
    inMemoryAuthStorage.delete(AUTH_SESSION_STORAGE_KEY)
    return
  }

  const storageScopes: Array<'local' | 'session'> =
    scope === 'all' ? ['local', 'session'] : [scope]

  for (const storageScope of storageScopes) {
    const storage = getBrowserStorage(storageScope)

    if (!storage) {
      continue
    }

    try {
      storage.removeItem(AUTH_SESSION_STORAGE_KEY)
    } catch (error) {
      console.error('Failed to clear auth session storage.', error)
    }
  }

  inMemoryAuthStorage.delete(AUTH_SESSION_STORAGE_KEY)
}

function getActiveAuthStorage(): AuthStorage {
  if (isNativeSessionPersistenceRuntime()) {
    return nativeSessionStorage
  }

  return createBrowserAuthStorage()
}

function createBrowserAuthStorage(): AuthStorage {
  return {
    getItem(key) {
      const storage = getBrowserStorage(
        getRememberSessionPreference() ? 'local' : 'session',
      )

      if (!storage) {
        return inMemoryAuthStorage.get(key) ?? null
      }

      try {
        return storage.getItem(key)
      } catch (error) {
        console.error('Failed to read auth session storage.', error)
        return inMemoryAuthStorage.get(key) ?? null
      }
    },
    removeItem(key) {
      const storage = getBrowserStorage(
        getRememberSessionPreference() ? 'local' : 'session',
      )

      if (storage) {
        try {
          storage.removeItem(key)
        } catch (error) {
          console.error('Failed to remove auth session storage.', error)
        }
      }

      inMemoryAuthStorage.delete(key)
    },
    setItem(key, value) {
      const storage = getBrowserStorage(
        getRememberSessionPreference() ? 'local' : 'session',
      )

      if (!storage) {
        inMemoryAuthStorage.set(key, value)
        return
      }

      try {
        storage.setItem(key, value)
        inMemoryAuthStorage.delete(key)
      } catch (error) {
        console.error('Failed to write auth session storage.', error)
        inMemoryAuthStorage.set(key, value)
      }
    },
  }
}

function getBrowserStorage(scope: 'local' | 'session'): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return scope === 'local' ? window.localStorage : window.sessionStorage
  } catch {
    return null
  }
}

function isStoredAuthSession(value: unknown): value is StoredAuthSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    'accessToken' in value &&
    'email' in value &&
    'expiresAt' in value &&
    'userId' in value &&
    typeof value.accessToken === 'string' &&
    typeof value.email === 'string' &&
    typeof value.expiresAt === 'string' &&
    (!('refreshToken' in value) || typeof value.refreshToken === 'string') &&
    typeof value.userId === 'string'
  )
}
