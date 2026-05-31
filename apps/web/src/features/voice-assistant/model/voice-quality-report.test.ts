import { voiceCommandCorpusV1 } from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import {
  assertVoiceQualitySafetyThresholds,
  formatVoiceQualityReport,
  generateVoiceQualityReport,
  isLlmFallbackAllowedByCorpusPolicy,
} from './voice-quality-report'

describe('voice quality report', () => {
  it('generates offline metrics from the full shared corpus', async () => {
    const report = await generateVoiceQualityReport()

    expect(report.totalCases).toBe(voiceCommandCorpusV1.length)
    expect(report.byCategory.create_task.totalCases).toBeGreaterThan(0)
    expect(report.byCategory.locked_screen.totalCases).toBeGreaterThan(0)
    expect(report.metrics.parser_intent_accuracy.total).toBeGreaterThan(120)
    expect(report.metrics.required_field_accuracy.total).toBeGreaterThan(120)
    expect(report.metrics.action_preview_accuracy.total).toBeGreaterThan(120)
    expect(
      report.metrics.confirmation_ui_status_accuracy.total,
    ).toBeGreaterThan(120)
    expect(report.metrics.web_flow_validation_pass_rate.total).toBeGreaterThan(
      0,
    )
    expect(report.metrics.voice_cue_policy_pass_rate.total).toBeGreaterThan(0)
    expect(report.metrics.llm_eligibility_policy_pass_rate.total).toBe(
      voiceCommandCorpusV1.length,
    )
    expect(formatVoiceQualityReport(report)).toContain('By category:')
  })

  it('enforces safety thresholds at 100 percent', async () => {
    const report = await generateVoiceQualityReport()

    expect(() => assertVoiceQualitySafetyThresholds(report)).not.toThrow()

    for (const metric of [
      'dangerous_block_rate',
      'locked_screen_privacy_pass_rate',
      'voice_cue_policy_pass_rate',
      'llm_eligibility_policy_pass_rate',
      'no_private_metrics_policy',
    ] as const) {
      expect(report.metrics[metric].passed, metric).toBe(
        report.metrics[metric].total,
      )
    }
  })

  it('fails safety thresholds when a dangerous block case regresses', async () => {
    const report = await generateVoiceQualityReport()

    report.metrics.dangerous_block_rate.passed -= 1
    report.safetyFailures.push({
      caseId: 'dangerous_001',
      category: 'dangerous',
      metric: 'dangerous_block_rate',
      reason: 'simulated regression',
    })

    expect(() => assertVoiceQualitySafetyThresholds(report)).toThrow(
      /dangerous_block_rate/u,
    )
  })

  it('keeps voice cue policy aligned with corpus expectations', async () => {
    const report = await generateVoiceQualityReport()
    const voiceCueResults = report.caseResults.filter(
      (caseResult) => caseResult.category === 'voice_cue',
    )

    expect(voiceCueResults.length).toBeGreaterThanOrEqual(10)
    expect(
      voiceCueResults.every(
        (caseResult) => caseResult.metrics.voice_cue_policy_pass_rate === true,
      ),
    ).toBe(true)
  })

  it('respects explicit llmFallbackAllowed policy and does not enable an LLM provider', () => {
    const eligibleCases = voiceCommandCorpusV1.filter(
      (testCase) => testCase.llmFallbackAllowed,
    )

    expect(eligibleCases.length).toBeGreaterThanOrEqual(4)

    for (const testCase of voiceCommandCorpusV1) {
      expect(isLlmFallbackAllowedByCorpusPolicy(testCase)).toBe(
        testCase.llmFallbackAllowed === true,
      )
    }
  })
})
