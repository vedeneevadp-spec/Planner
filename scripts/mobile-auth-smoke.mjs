import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

import { npmCommand, runCommand } from './command-utils.mjs'

const args = process.argv.slice(2)
const options = parseOptions(args)
const platform = options.platform ?? 'android'
const apiUrl = options.apiUrl ?? process.env.VITE_API_BASE_URL ?? ''

if (!options.skipTests && !options.printOnly) {
  await runCommand(npmCommand(), ['run', 'test:mobile-auth'])
}

printHeader(platform, apiUrl)
printPreparation(platform, apiUrl)
printChecklist()
printDiagnosticsGuide()

if (!process.stdout.isTTY || options.printOnly) {
  process.exit(0)
}

const readline = createInterface({ input, output })

try {
  for (const step of smokeSteps()) {
    await readline.question(
      `\n[mobile-auth-smoke] ${step}\nPress Enter when passed.`,
    )
  }

  console.log('\n[mobile-auth-smoke] Manual mobile auth smoke completed.')
} finally {
  readline.close()
}

function parseOptions(values) {
  const parsed = {
    apiUrl: null,
    platform: null,
    printOnly: false,
    skipTests: false,
  }

  for (const value of values) {
    if (value === '--android' || value === 'android') {
      parsed.platform = 'android'
      continue
    }

    if (value === '--ios' || value === 'ios') {
      parsed.platform = 'ios'
      continue
    }

    if (value === '--print-only') {
      parsed.printOnly = true
      continue
    }

    if (value === '--skip-tests') {
      parsed.skipTests = true
      continue
    }

    if (value.startsWith('--api-url=')) {
      parsed.apiUrl = value.slice('--api-url='.length)
      continue
    }

    throw new Error(`Unknown option "${value}".`)
  }

  return parsed
}

function printHeader(platform, apiUrl) {
  console.log('\n[mobile-auth-smoke] Real-device mobile auth smoke')
  console.log(`[mobile-auth-smoke] Platform: ${platform}`)
  console.log(
    `[mobile-auth-smoke] API URL: ${apiUrl || 'not set; pass --api-url=https://...'}`,
  )
}

function printPreparation(platform, apiUrl) {
  const syncScript =
    platform === 'ios' ? 'mobile:sync:ios' : 'mobile:sync:android'
  const openScript =
    platform === 'ios' ? 'mobile:open:ios' : 'mobile:open:android'
  const apiPrefix = apiUrl ? `VITE_API_BASE_URL=${apiUrl} ` : ''

  console.log('\nPreparation:')
  console.log(`1. ${apiPrefix}npm run ${syncScript}`)
  console.log(`2. npm run ${openScript}`)
  console.log('3. Run the app on a physical device or emulator.')

  if (
    apiUrl &&
    !apiUrl.startsWith('https://') &&
    !apiUrl.includes('10.0.2.2')
  ) {
    console.log(
      '[mobile-auth-smoke] Warning: physical devices should use an HTTPS API URL.',
    )
  }
}

function printChecklist() {
  console.log('\nChecklist:')

  smokeSteps().forEach((step, index) => {
    console.log(`${index + 1}. ${step}`)
  })
}

function printDiagnosticsGuide() {
  console.log('\nDiagnostics to inspect if anything moves unexpectedly:')
  console.log(
    '- Android Studio Logcat / Safari Web Inspector: [chaotika:event]',
  )
  console.log('- WebView console: window.__CHAOTIKA_DIAGNOSTICS__.events')
  console.log('- Critical event names:')
  console.log('  auth_refresh_deferred')
  console.log('  auth_device_session_kept')
  console.log('  auth_session_cleared')
  console.log('  offline_mutation_conflicted')
  console.log('  widget_completion_replayed')
  console.log('  widget_completion_queued')
  console.log('  widget_completion_acknowledged')
}

function smokeSteps() {
  return [
    'Install or open the native app and sign in once.',
    'Fully close and reopen the app; content must appear without a blocking "Проверяем сохраненный вход" flash over cached content.',
    'Send the app to background and resume it; user must stay signed in and content must not reset to empty sections.',
    'Disable network, resume the app, and confirm there is no silent logout or sign-in form.',
    'Enable network again and confirm planner data refreshes without a retry storm.',
    'Complete a planner task from the Android widget, then open the app; "Еще" must not show an offline conflict caused by that completion.',
    'Open "Еще" and confirm sign-out is only available as an intentional account action, not under native accidental action points.',
  ]
}
