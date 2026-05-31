import {
  assertVoiceQualitySafetyThresholds,
  formatVoiceQualityReport,
  generateVoiceQualityReport,
} from '../apps/web/src/features/voice-assistant/model/voice-quality-report.ts'

const report = await generateVoiceQualityReport()

process.stdout.write(formatVoiceQualityReport(report))
assertVoiceQualitySafetyThresholds(report)
