import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'

import {
  type ColorTheme,
  ThemeContext,
  type ThemeContextValue,
} from './theme-context'

const THEME_STORAGE_KEY = 'chaotika.color-theme'
const LIGHT_THEME_COLOR = '#214e42'
const DARK_THEME_COLOR = '#0f1714'

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setThemeState] = useState<ColorTheme>(() =>
    getInitialColorTheme(),
  )

  const setTheme = useCallback((nextTheme: ColorTheme) => {
    setThemeState(nextTheme)
    writeStoredColorTheme(nextTheme)
    applyColorTheme(nextTheme)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((currentTheme) => {
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark'

      writeStoredColorTheme(nextTheme)
      applyColorTheme(nextTheme)

      return nextTheme
    })
  }, [])

  useEffect(() => {
    applyColorTheme(theme)
  }, [theme])

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY) {
        return
      }

      const nextTheme = parseColorTheme(event.newValue)

      if (nextTheme) {
        setThemeState(nextTheme)
        applyColorTheme(nextTheme)
      }
    }

    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme,
      isDark: theme === 'dark',
      setTheme,
      toggleTheme,
    }),
    [setTheme, theme, toggleTheme],
  )

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  )
}

function getInitialColorTheme(): ColorTheme {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const storedTheme = readStoredColorTheme()

  if (storedTheme) {
    return storedTheme
  }

  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function parseColorTheme(value: string | null): ColorTheme | null {
  if (value === 'light' || value === 'dark') {
    return value
  }

  return null
}

function readStoredColorTheme(): ColorTheme | null {
  try {
    return parseColorTheme(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return null
  }
}

function writeStoredColorTheme(theme: ColorTheme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // The visual theme still applies when storage is unavailable.
  }
}

function applyColorTheme(theme: ColorTheme) {
  document.documentElement.dataset.theme = theme

  const themeColorMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  )

  themeColorMeta?.setAttribute(
    'content',
    theme === 'dark' ? DARK_THEME_COLOR : LIGHT_THEME_COLOR,
  )
}
