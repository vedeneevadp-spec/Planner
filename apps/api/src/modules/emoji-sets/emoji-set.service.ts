import { HttpError } from '../../bootstrap/http-error.js'
import type {
  CreateEmojiSetCommand,
  EmojiSetReadContext,
  EmojiSetWriteContext,
} from './emoji-set.model.js'
import type { EmojiSetRepository } from './emoji-set.repository.js'
import { normalizeEmojiSetInput } from './emoji-set.shared.js'

export class EmojiSetService {
  constructor(private readonly repository: EmojiSetRepository) {}

  listEmojiSets(context: EmojiSetReadContext) {
    return this.repository.listByWorkspace(context)
  }

  getEmojiSet(context: EmojiSetReadContext, emojiSetId: string) {
    return this.repository.getById(context, emojiSetId)
  }

  createEmojiSet(
    context: EmojiSetWriteContext,
    input: CreateEmojiSetCommand['input'],
  ) {
    assertCanManageEmojiSets(context)
    assertValidEmojiSetInput(input)

    return this.repository.create({ context, input })
  }
}

function assertCanManageEmojiSets(context: EmojiSetWriteContext): void {
  if (context.role && !['admin', 'owner'].includes(context.role)) {
    throw new HttpError(
      403,
      'workspace_admin_required',
      'The current workspace role cannot manage emoji sets.',
    )
  }
}

function assertValidEmojiSetInput(input: CreateEmojiSetCommand['input']): void {
  const normalizedInput = normalizeEmojiSetInput(input)
  const seenShortcodes = new Set<string>()
  const duplicateShortcodes = new Set<string>()

  if (!normalizedInput.title) {
    throw new HttpError(
      400,
      'invalid_body',
      'Emoji set title must not be empty.',
    )
  }

  for (const item of normalizedInput.items) {
    if (!item.label || !item.value || !item.shortcode) {
      throw new HttpError(
        400,
        'invalid_body',
        'Emoji items require label, shortcode and value.',
      )
    }

    if (seenShortcodes.has(item.shortcode)) {
      duplicateShortcodes.add(item.shortcode)
    }

    seenShortcodes.add(item.shortcode)
  }

  if (duplicateShortcodes.size > 0) {
    throw new HttpError(
      400,
      'duplicate_emoji_shortcodes',
      'Emoji item shortcodes must be unique inside a set.',
      {
        shortcodes: [...duplicateShortcodes],
      },
    )
  }
}
