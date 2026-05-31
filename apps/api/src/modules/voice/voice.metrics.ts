import {
  parseSafeVoiceMetricEvent,
  redactVoiceMetricDetails,
  type SafeVoiceMetricEvent,
  type VoiceMetricsSink,
} from '@planner/contracts'

interface VoiceMetricRecorder {
  record(event: string, details?: Record<string, unknown>): void
}

export class ApiVoiceMetricsSink implements VoiceMetricsSink {
  constructor(private readonly recorder: VoiceMetricRecorder) {}

  track(event: SafeVoiceMetricEvent): void {
    const safeEvent = parseSafeVoiceMetricEvent(event)

    this.recorder.record(
      safeEvent.eventName,
      redactVoiceMetricDetails(safeEvent as unknown as Record<string, unknown>),
    )
  }
}
