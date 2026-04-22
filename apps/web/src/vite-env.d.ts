/// <reference types="vite/client" />

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module 'lottie-web/build/player/lottie_light_canvas' {
  import type { LottiePlayer } from 'lottie-web'

  const Lottie: LottiePlayer
  export default Lottie
}
