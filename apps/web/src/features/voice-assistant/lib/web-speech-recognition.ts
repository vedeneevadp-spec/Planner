interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionResultListLike {
  readonly length: number
  [index: number]: SpeechRecognitionResultLike
}

interface SpeechRecognitionEventLike extends Event {
  readonly results: SpeechRecognitionResultListLike
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  abort: () => void
  start: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

export interface CaptureWebSpeechTranscriptOptions {
  lang?: string
  timeoutMs?: number
}

export function isWebSpeechRecognitionSupported(): boolean {
  return Boolean(getSpeechRecognitionConstructor())
}

export function captureWebSpeechTranscript({
  lang = 'ru-RU',
  timeoutMs = 10_000,
}: CaptureWebSpeechTranscriptOptions = {}): Promise<string> {
  const Recognition = getSpeechRecognitionConstructor()

  if (!Recognition) {
    return Promise.reject(new Error('Браузер не поддерживает голосовой ввод.'))
  }

  return new Promise((resolve, reject) => {
    const recognition = new Recognition()
    let didSettle = false
    const timeoutId = window.setTimeout(() => {
      settle(() => reject(new Error('Не удалось распознать команду.')))
    }, timeoutMs)

    function settle(action: () => void) {
      if (didSettle) {
        return
      }

      didSettle = true
      window.clearTimeout(timeoutId)
      recognition.onend = null
      recognition.onerror = null
      recognition.onresult = null
      action()
    }

    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = lang
    recognition.maxAlternatives = 1
    recognition.onresult = (event) => {
      const transcript = getTranscript(event.results)

      if (!transcript) {
        return
      }

      settle(() => resolve(transcript))
    }
    recognition.onerror = (event) => {
      settle(() => reject(new Error(getSpeechRecognitionErrorMessage(event))))
    }
    recognition.onend = () => {
      settle(() => reject(new Error('Команда не распознана.')))
    }

    try {
      recognition.start()
    } catch (error) {
      settle(() => {
        reject(
          error instanceof Error ? error : new Error('Микрофон недоступен.'),
        )
      })
    }
  })
}

function getSpeechRecognitionConstructor():
  | SpeechRecognitionConstructor
  | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const speechWindow = window as SpeechRecognitionWindow

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
}

function getTranscript(results: SpeechRecognitionResultListLike): string {
  const transcripts: string[] = []

  for (let index = 0; index < results.length; index += 1) {
    const result = results[index]
    const alternative = result?.[0]

    if (alternative?.transcript) {
      transcripts.push(alternative.transcript)
    }
  }

  return transcripts.join(' ').replace(/\s+/g, ' ').trim()
}

function getSpeechRecognitionErrorMessage(
  event: SpeechRecognitionErrorEventLike,
): string {
  if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
    return 'Нет доступа к микрофону.'
  }

  if (event.error === 'no-speech') {
    return 'Речь не распознана.'
  }

  return 'Не удалось распознать команду.'
}
