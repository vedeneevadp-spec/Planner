import {
  createClient,
  type SupabaseClient,
  type SupportedStorage,
} from '@supabase/supabase-js'

import {
  hasSupabaseBrowserAuthConfig,
  plannerApiConfig,
} from '@/shared/config/planner-api'

let browserSupabaseClient: SupabaseClient | null = null
const REMEMBER_SESSION_STORAGE_KEY = 'planner.rememberSession'
const inMemorySupabaseStorage = new Map<string, string>()

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
        storage: createSupabaseBrowserStorage(),
      },
    },
  )

  return browserSupabaseClient
}

export function getRememberSessionPreference(): boolean {
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

  clearSupabaseBrowserAuthStorage(remember ? 'session' : 'local')
}

export function clearSupabaseBrowserAuthStorage(
  scope: 'all' | 'local' | 'session' = 'all',
): void {
  const storageKey = getSupabaseAuthStorageKey(plannerApiConfig.supabaseUrl)

  if (!storageKey) {
    return
  }

  const keys = [storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`]
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
