import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_INPUT_DIR = 'datasets/wakeword/haotika/android-positive/positive'
const DEFAULT_REPORT_DIR = 'datasets/wakeword/haotika/reports'

const EXPECTED_SAMPLE_RATE = 16_000
const EXPECTED_CHANNELS = 1
const EXPECTED_BITS_PER_SAMPLE = 16
const MIN_DURATION_MS = 300
const MAX_DURATION_MS = 2_000
const MIN_PEAK = 0.03
const MIN_RMS = 0.006
const MAX_CLIPPING_RATIO = 0.001
const SILENCE_THRESHOLD = 500
const MAX_EDGE_SILENCE_MS = 200

const inputDir = process.argv[2] ?? DEFAULT_INPUT_DIR
const reportDir = process.argv[3] ?? DEFAULT_REPORT_DIR

async function main() {
  const wavFiles = (await listWavFiles(inputDir)).sort()

  if (wavFiles.length === 0) {
    throw new Error(`No WAV files found in ${inputDir}`)
  }

  const rows = []

  for (const filePath of wavFiles) {
    rows.push(await auditWav(filePath))
  }

  await mkdir(reportDir, { recursive: true })

  const reportBase = path.join(reportDir, 'android-positive-audit')
  await writeFile(`${reportBase}.csv`, renderCsv(rows))
  await writeFile(`${reportBase}.md`, renderMarkdown(rows))

  const failedCount = rows.filter((row) => row.status === 'fail').length
  const warningCount = rows.filter((row) => row.status === 'warn').length
  const passedCount = rows.filter((row) => row.status === 'pass').length

  console.log(`Audited ${rows.length} WAV files from ${inputDir}`)
  console.log(`Passed: ${passedCount}`)
  console.log(`Warnings: ${warningCount}`)
  console.log(`Failed: ${failedCount}`)
  console.log(`Report: ${reportBase}.md`)
  console.log(`CSV: ${reportBase}.csv`)

  process.exitCode = failedCount > 0 ? 1 : 0
}

async function listWavFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      files.push(...(await listWavFiles(entryPath)))
      continue
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith('.wav')) {
      files.push(entryPath)
    }
  }

  return files
}

async function auditWav(filePath) {
  const buffer = await readFile(filePath)
  const issues = []
  const warnings = []
  const speakerId = speakerFromName(path.basename(filePath))

  try {
    const wav = parseWav(buffer)
    const metrics = analyzePcm16(wav)

    if (wav.audioFormat !== 1) {
      issues.push(`audioFormat=${wav.audioFormat}, expected PCM`)
    }

    if (wav.channels !== EXPECTED_CHANNELS) {
      issues.push(`channels=${wav.channels}, expected ${EXPECTED_CHANNELS}`)
    }

    if (wav.sampleRate !== EXPECTED_SAMPLE_RATE) {
      issues.push(
        `sampleRate=${wav.sampleRate}, expected ${EXPECTED_SAMPLE_RATE}`,
      )
    }

    if (wav.bitsPerSample !== EXPECTED_BITS_PER_SAMPLE) {
      issues.push(
        `bitsPerSample=${wav.bitsPerSample}, expected ${EXPECTED_BITS_PER_SAMPLE}`,
      )
    }

    if (metrics.durationMs < MIN_DURATION_MS) {
      issues.push(`too short: ${metrics.durationMs.toFixed(0)}ms`)
    }

    if (metrics.durationMs > MAX_DURATION_MS) {
      issues.push(`too long: ${metrics.durationMs.toFixed(0)}ms`)
    }

    if (metrics.peak < MIN_PEAK) {
      issues.push(`too quiet peak=${metrics.peak.toFixed(3)}`)
    }

    if (metrics.rms < MIN_RMS) {
      issues.push(`too quiet rms=${metrics.rms.toFixed(3)}`)
    }

    if (metrics.clippingRatio > MAX_CLIPPING_RATIO) {
      issues.push(`clipping=${formatPercent(metrics.clippingRatio)}`)
    }

    if (metrics.leadingSilenceMs > MAX_EDGE_SILENCE_MS) {
      warnings.push(`leading silence ${metrics.leadingSilenceMs.toFixed(0)}ms`)
    }

    if (metrics.trailingSilenceMs > MAX_EDGE_SILENCE_MS) {
      warnings.push(
        `trailing silence ${metrics.trailingSilenceMs.toFixed(0)}ms`,
      )
    }

    return {
      file: normalizePath(filePath),
      speakerId,
      status:
        issues.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass',
      issues,
      warnings,
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      bitsPerSample: wav.bitsPerSample,
      durationMs: metrics.durationMs,
      peak: metrics.peak,
      rms: metrics.rms,
      rmsDb: dbfs(metrics.rms),
      clippingRatio: metrics.clippingRatio,
      leadingSilenceMs: metrics.leadingSilenceMs,
      trailingSilenceMs: metrics.trailingSilenceMs,
    }
  } catch (error) {
    return {
      file: normalizePath(filePath),
      speakerId,
      status: 'fail',
      issues: [error instanceof Error ? error.message : String(error)],
      warnings,
      sampleRate: 0,
      channels: 0,
      bitsPerSample: 0,
      durationMs: 0,
      peak: 0,
      rms: 0,
      rmsDb: Number.NEGATIVE_INFINITY,
      clippingRatio: 0,
      leadingSilenceMs: 0,
      trailingSilenceMs: 0,
    }
  }
}

function parseWav(buffer) {
  if (buffer.length < 44) {
    throw new Error('WAV file is too small')
  }

  if (
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new Error('Not a RIFF/WAVE file')
  }

  let offset = 12
  let fmt = null
  let dataStart = -1
  let dataSize = 0

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkSize

    if (chunkEnd > buffer.length) {
      throw new Error(`Invalid ${chunkId} chunk size`)
    }

    if (chunkId === 'fmt ') {
      if (chunkSize < 16) {
        throw new Error('Invalid fmt chunk')
      }

      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        byteRate: buffer.readUInt32LE(chunkStart + 8),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      }
    }

    if (chunkId === 'data') {
      dataStart = chunkStart
      dataSize = chunkSize
    }

    offset = chunkEnd + (chunkSize % 2)
  }

  if (!fmt) {
    throw new Error('Missing fmt chunk')
  }

  if (dataStart < 0 || dataSize <= 0) {
    throw new Error('Missing data chunk')
  }

  return {
    ...fmt,
    data: buffer.subarray(dataStart, dataStart + dataSize),
  }
}

function analyzePcm16(wav) {
  if (wav.bitsPerSample !== 16 || wav.blockAlign <= 0) {
    return {
      durationMs: 0,
      peak: 0,
      rms: 0,
      clippingRatio: 0,
      leadingSilenceMs: 0,
      trailingSilenceMs: 0,
    }
  }

  const sampleCount = Math.floor(wav.data.length / 2)
  let peak = 0
  let sumSquares = 0
  let clippingSamples = 0
  let firstVoiceSample = -1
  let lastVoiceSample = -1

  for (
    let byteOffset = 0, sampleIndex = 0;
    byteOffset + 1 < wav.data.length;
    byteOffset += 2, sampleIndex += 1
  ) {
    const sample = wav.data.readInt16LE(byteOffset)
    const absSample = Math.abs(sample)

    peak = Math.max(peak, absSample)
    sumSquares += sample * sample

    if (absSample >= 32_760) {
      clippingSamples += 1
    }

    if (absSample > SILENCE_THRESHOLD) {
      if (firstVoiceSample < 0) {
        firstVoiceSample = sampleIndex
      }
      lastVoiceSample = sampleIndex
    }
  }

  const frameCount = wav.data.length / wav.blockAlign
  const durationMs = (frameCount / wav.sampleRate) * 1_000
  const peakNormalized = peak / 32_768
  const rms = Math.sqrt(sumSquares / sampleCount) / 32_768

  return {
    durationMs,
    peak: peakNormalized,
    rms,
    clippingRatio: clippingSamples / sampleCount,
    leadingSilenceMs:
      firstVoiceSample < 0
        ? durationMs
        : (firstVoiceSample / wav.sampleRate) * 1_000,
    trailingSilenceMs:
      lastVoiceSample < 0
        ? durationMs
        : ((sampleCount - lastVoiceSample - 1) / wav.sampleRate) * 1_000,
  }
}

function renderMarkdown(rows) {
  const failed = rows.filter((row) => row.status === 'fail')
  const warnings = rows.filter((row) => row.status === 'warn')
  const passed = rows.filter((row) => row.status === 'pass')
  const bySpeaker = speakerSummary(rows)
  const durations = rows
    .map((row) => row.durationMs)
    .filter((durationMs) => durationMs > 0)
  const rmsValues = rows.map((row) => row.rmsDb).filter(Number.isFinite)

  const lines = [
    '# Android Positive Wake-Word Audit',
    '',
    `Input: \`${normalizePath(inputDir)}\``,
    '',
    '## Summary',
    '',
    `- Files: ${rows.length}`,
    `- Passed: ${passed.length}`,
    `- Warnings: ${warnings.length}`,
    `- Failed: ${failed.length}`,
    `- Duration: ${formatRange(durations, 'ms')}`,
    `- RMS: ${formatRange(rmsValues, 'dBFS')}`,
    '',
    '## Speakers',
    '',
    '| Speaker | Files | Passed | Warnings | Failed |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...bySpeaker.map(
      (speaker) =>
        `| ${speaker.speakerId} | ${speaker.total} | ${speaker.pass} | ${speaker.warn} | ${speaker.fail} |`,
    ),
    '',
    '## Failed Files',
    '',
    ...renderIssueList(failed),
    '',
    '## Warning Files',
    '',
    ...renderIssueList(warnings),
  ]

  return `${lines.join('\n')}\n`
}

function renderIssueList(rows) {
  if (rows.length === 0) {
    return ['None.']
  }

  return rows.map((row) => {
    const notes = [...row.issues, ...row.warnings].join('; ')
    return `- \`${row.file}\`: ${notes}`
  })
}

function renderCsv(rows) {
  const header = [
    'file',
    'speakerId',
    'status',
    'sampleRate',
    'channels',
    'bitsPerSample',
    'durationMs',
    'peak',
    'rms',
    'rmsDb',
    'clippingRatio',
    'leadingSilenceMs',
    'trailingSilenceMs',
    'issues',
    'warnings',
  ]

  const csvRows = rows.map((row) =>
    [
      row.file,
      row.speakerId,
      row.status,
      row.sampleRate,
      row.channels,
      row.bitsPerSample,
      row.durationMs.toFixed(2),
      row.peak.toFixed(4),
      row.rms.toFixed(4),
      Number.isFinite(row.rmsDb) ? row.rmsDb.toFixed(2) : '',
      row.clippingRatio.toFixed(6),
      row.leadingSilenceMs.toFixed(2),
      row.trailingSilenceMs.toFixed(2),
      row.issues.join('; '),
      row.warnings.join('; '),
    ].map(escapeCsv),
  )

  return [header, ...csvRows].map((row) => row.join(',')).join('\n') + '\n'
}

function speakerSummary(rows) {
  const speakers = new Map()

  for (const row of rows) {
    const speaker = speakers.get(row.speakerId) ?? {
      speakerId: row.speakerId,
      total: 0,
      pass: 0,
      warn: 0,
      fail: 0,
    }

    speaker.total += 1
    speaker[row.status] += 1
    speakers.set(row.speakerId, speaker)
  }

  return [...speakers.values()].sort((a, b) =>
    a.speakerId.localeCompare(b.speakerId),
  )
}

function speakerFromName(fileName) {
  const match = /^(speaker_\d+)_\d+\.wav$/i.exec(fileName)
  return match?.[1] ?? 'unknown'
}

function escapeCsv(value) {
  const text = String(value)

  if (!/[",\n]/.test(text)) {
    return text
  }

  return `"${text.replaceAll('"', '""')}"`
}

function formatRange(values, unit) {
  if (values.length === 0) {
    return 'n/a'
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length

  return `${min.toFixed(1)}-${max.toFixed(1)} ${unit}, avg ${avg.toFixed(1)} ${unit}`
}

function formatPercent(value) {
  return `${(value * 100).toFixed(3)}%`
}

function dbfs(value) {
  if (value <= 0) {
    return Number.NEGATIVE_INFINITY
  }

  return 20 * Math.log10(value)
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
