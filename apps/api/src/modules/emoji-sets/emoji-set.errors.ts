import { HttpError } from '../../bootstrap/http-error.js'

export class EmojiSetNotFoundError extends HttpError {
  constructor(emojiSetId: string) {
    super(404, 'emoji_set_not_found', `Icon set "${emojiSetId}" was not found.`)
  }
}

export class EmojiAssetNotFoundError extends HttpError {
  constructor(iconAssetId: string) {
    super(
      404,
      'emoji_asset_not_found',
      `Icon asset "${iconAssetId}" was not found.`,
    )
  }
}
