import {
  analyzePcm16Audio,
  getAudioContextConstructor,
  WEB_VOICE_SAMPLE_RATE_HERTZ,
  type WebVoiceRecording,
} from '../model/web-voice-input'

export interface WebVoiceRecorder {
  cancel: () => void
  stop: () => Promise<WebVoiceRecording>
}

interface RecorderRuntime {
  audioContext: AudioContext
  mediaRecorder: MediaRecorder
  processor: ScriptProcessorNode
  silentOutput: GainNode
  source: MediaStreamAudioSourceNode
  stream: MediaStream
}

const MEDIA_RECORDER_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const

export async function startWebVoiceRecorder(): Promise<WebVoiceRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
    video: false,
  })

  try {
    return await createRecorder(stream)
  } catch (error) {
    stopStream(stream)
    throw error
  }
}

async function createRecorder(stream: MediaStream): Promise<WebVoiceRecorder> {
  const AudioContextConstructor = getAudioContextConstructor()

  if (!AudioContextConstructor) {
    throw new Error('Голосовой ввод недоступен в этом браузере.')
  }

  const audioContext = new AudioContextConstructor()
  const source = audioContext.createMediaStreamSource(stream)
  const processor = audioContext.createScriptProcessor(4096, 1, 1)
  const silentOutput = audioContext.createGain()
  const floatChunks: Float32Array[] = []
  const mediaChunks: Blob[] = []
  const mediaRecorder = createMediaRecorder(stream)
  let isCancelled = false
  let stopPromise: Promise<WebVoiceRecording> | null = null
  const startedAt = performance.now()

  silentOutput.gain.value = 0
  processor.onaudioprocess = (event) => {
    if (isCancelled) {
      return
    }

    const input = event.inputBuffer.getChannelData(0)
    floatChunks.push(new Float32Array(input))
  }

  source.connect(processor)
  processor.connect(silentOutput)
  silentOutput.connect(audioContext.destination)

  const runtime: RecorderRuntime = {
    audioContext,
    mediaRecorder,
    processor,
    silentOutput,
    source,
    stream,
  }

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      mediaChunks.push(event.data)
    }
  }

  try {
    await audioContext.resume()
    mediaRecorder.start()
  } catch (error) {
    cleanupRuntime(runtime)
    throw error
  }

  return {
    cancel() {
      isCancelled = true
      mediaRecorder.onstop = () => {
        cleanupRuntime(runtime)
      }
      stopRuntime(runtime)
    },
    stop() {
      if (stopPromise) {
        return stopPromise
      }

      stopPromise = new Promise<WebVoiceRecording>((resolve, reject) => {
        mediaRecorder.onstop = () => {
          const durationMs = Math.round(performance.now() - startedAt)
          const audio = createPcm16Audio(
            floatChunks,
            audioContext.sampleRate,
            WEB_VOICE_SAMPLE_RATE_HERTZ,
          )

          cleanupRuntime(runtime)
          resolve({
            analysis: analyzePcm16Audio(audio),
            audio,
            byteLength: audio.byteLength,
            durationMs,
            mediaRecorderMimeType: mediaRecorder.mimeType || undefined,
          })
        }
        mediaRecorder.onerror = () => {
          cleanupRuntime(runtime)
          reject(new Error('Запись прервана.'))
        }

        stopRuntime(runtime)
      })

      return stopPromise
    },
  }
}

function createMediaRecorder(stream: MediaStream): MediaRecorder {
  const mimeType = getSupportedMediaRecorderMimeType()

  return mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream)
}

function getSupportedMediaRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined
  }

  return MEDIA_RECORDER_MIME_TYPES.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  )
}

function stopRuntime(runtime: RecorderRuntime): void {
  if (runtime.mediaRecorder.state !== 'inactive') {
    runtime.mediaRecorder.stop()
    return
  }

  cleanupRuntime(runtime)
}

function cleanupRuntime(runtime: RecorderRuntime): void {
  runtime.processor.onaudioprocess = null
  runtime.source.disconnect()
  runtime.processor.disconnect()
  runtime.silentOutput.disconnect()
  stopStream(runtime.stream)
  void runtime.audioContext.close().catch(() => {})
}

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop()
  }
}

function createPcm16Audio(
  chunks: Float32Array[],
  sourceSampleRate: number,
  targetSampleRate: number,
): ArrayBuffer {
  const samples = mergeFloatChunks(chunks)
  const resampled =
    sourceSampleRate === targetSampleRate
      ? samples
      : resampleLinear(samples, sourceSampleRate, targetSampleRate)
  const audio = new ArrayBuffer(resampled.length * 2)
  const view = new DataView(audio)

  for (let index = 0; index < resampled.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, resampled[index] ?? 0))
    const pcm = sample < 0 ? sample * 0x8000 : sample * 0x7fff

    view.setInt16(index * 2, Math.round(pcm), true)
  }

  return audio
}

function mergeFloatChunks(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((length, chunk) => length + chunk.length, 0)
  const samples = new Float32Array(totalLength)
  let offset = 0

  for (const chunk of chunks) {
    samples.set(chunk, offset)
    offset += chunk.length
  }

  return samples
}

function resampleLinear(
  samples: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (samples.length === 0) {
    return samples
  }

  const ratio = sourceSampleRate / targetSampleRate
  const outputLength = Math.max(1, Math.round(samples.length / ratio))
  const output = new Float32Array(outputLength)

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio
    const leftIndex = Math.floor(sourceIndex)
    const rightIndex = Math.min(leftIndex + 1, samples.length - 1)
    const weight = sourceIndex - leftIndex
    const left = samples[leftIndex] ?? 0
    const right = samples[rightIndex] ?? left

    output[index] = left + (right - left) * weight
  }

  return output
}
