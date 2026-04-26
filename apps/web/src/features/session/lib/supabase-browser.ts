import {
  createClient,
  type Session,
  type SupabaseClient,
  type SupportedStorage,
} from '@supabase/supabase-js'

import {
  hasSupabaseBrowserAuthConfig,
  plannerApiConfig,
} from '@/shared/config/planner-api'

import {
  clearNativeSessionStorage,
  createNativeSessionStorage,
  isNativeSessionPersistenceRuntime,
} from './native-session-storage'

let browserSupabaseClient: SupabaseClient | null = null
const REMEMBER_SESSION_STORAGE_KEY = 'planner.rememberSession'
const inMemorySupabaseStorage = new Map<string, string>()
const nativeSessionStorage = createNativeSessionStorage()
const supabaseAuthStorage = createSupabaseAuthStorage()

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!hasSupabaseBrowserAuthConfig(plannerApiConfig)) {
    return null
  }

  if (browserSupabaseClient) {
    return browserSupabaseClient
  }

  browserSupabaseClient = createClient(
    plannerApiConfig.supabaseUrl,
    plannerApiConfig.supabasePublishableKey,
    {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
        storage: supabaseAuthStorage,
      },
    },
  )

  return browserSupabaseClient
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

  void clearSupabaseBrowserAuthStorage(remember ? 'session' : 'local')
}

export async function clearSupabaseBrowserAuthStorage(
  scope: 'all' | 'local' | 'session' = 'all',
): Promise<void> {
  const storageKey = getSupabaseAuthStorageKey(plannerApiConfig.supabaseUrl)

  if (!storageKey) {
    return
  }

  const keys = [storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`]

  if (isNativeSessionPersistenceRuntime()) {
    await clearNativeSessionStorage(keys)

    for (const key of keys) {
      inMemorySupabaseStorage.delete(key)
    }

    return
  }

  const storageScopes: Array<'local' | 'session'> =
    scope === 'all' ? ['local', 'session'] : [scope]

  for (const storageScope of storageScopes) {
    const storage = getBrowserStorage(storageScope)

    if (!storage) {
      continue
    }

    for (const key of keys) {
      try {
        storage.removeItem(key)
      } catch (error) {
        console.error('Failed to clear Supabase auth storage.', error)
      }
    }
  }

  for (const key of keys) {
    inMemorySupabaseStorage.delete(key)
  }
}

export async function readSupabaseStoredSession(): Promise<Session | null> {
  const storageKey = getSupabaseAuthStorageKey(plannerApiConfig.supabaseUrl)

  if (!storageKey) {
    return null
  }

  const rawSession = await supabaseAuthStorage.getItem(storageKey)

  if (!rawSession) {
    return null
  }

  try {
    const parsedSession = JSON.parse(rawSession) as unknown

    if (
      parsedSession &&
      typeof parsedSession === 'object' &&
      'access_token' in parsedSession
    ) {
      return parsedSession as Session
    }
  } catch (error) {
    console.error('Failed to parse stored Supabase session.', error)
  }

  return null
}

function createSupabaseAuthStorage(): SupportedStorage {
  if (isNativeSessionPersistenceRuntime()) {
    return nativeSessionStorage
  }

  return createSupabaseBrowserStorage()
}

function createSupabaseBrowserStorage(): SupportedStorage {
  return {
    getItem(key) {
      const storage = getActiveBrowserStorage()

      if (!storage) {
        return inMemorySupabaseStorage.get(key) ?? null
      }

      try {
        return storage.getItem(key)
      } catch (error) {
        console.error('Failed to read Supabase auth storage.', error)
        return inMemorySupabaseStorage.get(key) ?? null
      }
    },
    removeItem(key) {
      const storage = getActiveBrowserStorage()

      if (storage) {
        try {
          storage.removeItem(key)
        } catch (error) {
          console.error('Failed to remove Supabase auth storage.', error)
        }
      }

      inMemorySupabaseStorage.delete(key)
    },
    setItem(key, value) {
      const storage = getActiveBrowserStorage()

      if (!storage) {
        inMemorySupabaseStorage.set(key, value)
        return
      }

      try {
        storage.setItem(key, value)
        inMemorySupabaseStorage.delete(key)
      } catch (error) {
        console.error('Failed to write Supabase auth storage.', error)
        inMemorySupabaseStorage.set(key, value)
      }
    },
  }
}

function getActiveBrowserStorage(): Storage | null {
  return getBrowserStorage(getRememberSessionPreference() ? 'local' : 'session')
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

function getSupabaseAuthStorageKey(
  supabaseUrl: string | null | undefined,
): string | null {
  if (!supabaseUrl) {
    return null
  }

  try {
    const hostname = new URL(supabaseUrl).hostname
    const projectRef = hostname.split('.')[0]

    return projectRef ? `sb-${projectRef}-auth-token` : null
  } catch {
    return null
  }
}
