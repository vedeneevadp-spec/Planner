import { createContext, useContext } from 'react'

export type ColorTheme = 'light' | 'dark'

export interface ThemeContextValue {
  theme: ColorTheme
  isDark: boolean
  setTheme: (theme: ColorTheme) => void
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useColorTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)

  if (!context) {
    throw new Error('useColorTheme must be used within ThemeProvider.')
  }

  return context
}
