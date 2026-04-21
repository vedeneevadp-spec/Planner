import { HttpError } from '../../bootstrap/http-error.js'

export class EmojiSetNotFoundError extends HttpError {
  constructor(emojiSetId: string) {
    super(
      404,
      'emoji_set_not_found',
      `Emoji set "${emojiSetId}" was not found.`,
    )
  }
}
