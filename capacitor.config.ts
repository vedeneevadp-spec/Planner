import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ru.chaotika.app',
  appName: 'Chaotika',
  includePlugins: [
    '@capacitor/app',
    '@capacitor/preferences',
    '@capacitor/push-notifications',
  ],
  webDir: 'apps/web/dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
