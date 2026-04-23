import { describe, expect, it } from 'vitest'

import {
  MAX_CHAOS_TEXT_LENGTH,
  normalizeChaosText,
  parseChaosDump,
} from './chaos-dump'

describe('chaos dump parsing', () => {
  it('trims text and collapses long empty gaps', () => {
    expect(
      normalizeChaosText('  купить корм  \n\n\n\nответить клиенту  '),
    ).toBe('купить корм\n\nответить клиенту')
  })

  it('creates one item per non-empty line in line split mode', () => {
    expect(
      parseChaosDump('купить корм\n\nответить клиенту\n   ', {
        splitByLines: true,
      }),
    ).toEqual({
      error: null,
      items: ['купить корм', 'ответить клиенту'],
    })
  })

  it('keeps a paragraph as one item when line split is disabled', () => {
    expect(
      parseChaosDump('купить корм\nответить клиенту', {
        splitByLines: false,
      }).items,
    ).toEqual(['купить корм\nответить клиенту'])
  })

  it('rejects empty and too long input', () => {
    expect(parseChaosDump('   ', { splitByLines: false }).items).toEqual([])
    expect(
      parseChaosDump('x'.repeat(MAX_CHAOS_TEXT_LENGTH + 1), {
        splitByLines: false,
      }).error,
    ).toContain('Максимум')
  })
})
