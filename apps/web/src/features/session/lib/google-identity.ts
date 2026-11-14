import { Capacitor, registerPlugin } from '@capacitor/core'

import { isAndroidNativeRuntime } from '@/shared/lib/native-runtime'

interface GoogleIdentityApi {
  initialize(options: {
    auto_select: boolean
    callback: (response: { credential: string }) => void
    client_id: string
    nonce: string
    ux_mode: 'popup'
  }): void
  renderButton(
    element: HTMLElement,
    options: {
      locale: string
      shape: 'pill'
      size: 'large'
      text: 'continue_with'
      theme: 'outline' | 'outline_dark'
      type: 'standard'
      width: number
    },
  ): void
  disableAutoSelect(): void
}

interface PlannerGoogleSignInPlugin {
  signIn(options: {
    clientId: string
    nonce: string
  }): Promise<{ idToken: string }>
  signOut(): Promise<void>
}

const nativeGoogle = registerPlugin<PlannerGoogleSignInPlugin>(
  'PlannerGoogleSignIn',
)
let sdkPromise: Promise<GoogleIdentityApi> | null = null

export function isGoogleSignInSupported(): boolean {
  return (
    !Capacitor.isNativePlatform() ||
    (isAndroidNativeRuntime() &&
      Capacitor.isPluginAvailable('PlannerGoogleSignIn'))
  )
}

export function signInWithNativeGoogle(
  clientId: string,
  nonce: string,
): Promise<{ idToken: string }> {
  return nativeGoogle.signIn({ clientId, nonce })
}

export async function clearGoogleSignInState(): Promise<void> {
  if (
    isAndroidNativeRuntime() &&
    Capacitor.isPluginAvailable('PlannerGoogleSignIn')
  ) {
    await nativeGoogle.signOut()
  } else {
    readGoogleIdentity()?.disableAutoSelect()
  }
}

function readGoogleIdentity(): GoogleIdentityApi | undefined {
  return (
    window as Window & { google?: { accounts?: { id?: GoogleIdentityApi } } }
  ).google?.accounts?.id
}

export function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  const existing = readGoogleIdentity()
  if (existing) return Promise.resolve(existing)
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise<GoogleIdentityApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client?hl=ru'
    script.async = true
    const timer = window.setTimeout(() => fail(), 15_000)
    function fail() {
      window.clearTimeout(timer)
      script.remove()
      reject(new Error('Google sign-in could not load.'))
    }
    script.onerror = fail
    script.onload = () => {
      const api = readGoogleIdentity()
      if (!api) {
        fail()
        return
      }
      window.clearTimeout(timer)
      resolve(api)
    }
    document.head.append(script)
  }).catch((error: unknown) => {
    sdkPromise = null
    throw error
  })
  return sdkPromise
}
