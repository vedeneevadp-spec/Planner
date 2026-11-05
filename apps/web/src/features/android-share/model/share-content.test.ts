import { describe, expect, it } from 'vitest'

import { parseSharedContent, sharedTaskInput } from './share-content'

const requestId = '019a36fd-37fc-7015-8bd9-0384cdafa559'
const url = 'https://shop.example/item?color=red&size=s#details'
const message = (text: string, subject = '') => ({ requestId, text, subject })

describe('Android shared text', () => {
  it('uses the sender title or hostname while retaining the exact URL', () => {
    expect(parseSharedContent(message(url, 'Термокружка'))).toMatchObject({
      initialKind: 'purchase',
      initialTitle: 'Термокружка',
      url,
    })
    expect(parseSharedContent(message(url)).initialTitle).toBe('shop.example')
    expect(parseSharedContent(message('Термокружка\n' + url))).toMatchObject({
      initialKind: 'purchase',
      initialTitle: 'Термокружка',
    })
    expect(
      parseSharedContent(message('Термокружка ' + url, 'Термокружка'))
        .initialKind,
    ).toBe('purchase')
  })
  it('keeps prose with an inline link as a task and declines ambiguous or unsafe product URLs', () => {
    expect(parseSharedContent(message('Посмотри ' + url))).toMatchObject({
      initialKind: 'task',
      url,
    })
    for (const text of [
      url + '\nhttps://another.example',
      'javascript:alert(1)',
      'content://files/1',
      'https://',
      'https://shop.example/' + 'a'.repeat(8200),
    ]) {
      expect(parseSharedContent(message(text))).toMatchObject({
        initialKind: 'task',
        url: null,
      })
    }
  })
  it('keeps the original in the note when a long message is shortened, edited or contains extra lines', () => {
    const share = message('А'.repeat(239) + '📦 до пятницы\nВзять паспорт')
    const { initialTitle } = parseSharedContent(share)
    expect(initialTitle).toBe('А'.repeat(239))
    expect(sharedTaskInput(share, initialTitle, '2026-11-06')).toMatchObject({
      id: requestId,
      note: share.text,
      plannedDate: null,
      dueDate: '2026-11-06',
    })
    expect(sharedTaskInput(message(url), 'Посмотреть кружку', null).note).toBe(
      url,
    )
    expect(sharedTaskInput(message('Позвонить'), 'Позвонить', null).note).toBe(
      '',
    )
  })
})
