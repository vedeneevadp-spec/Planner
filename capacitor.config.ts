import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ru.chaotika.app',
  appName: 'Chaotika',
  webDir: 'apps/web/dist',
  server: {
    androidScheme: 'https',
  },
}

export default config
