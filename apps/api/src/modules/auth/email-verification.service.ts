import { createHash, randomBytes } from 'node:crypto'

import type { EmailVerificationStatus } from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type { RateLimiter } from '../../bootstrap/rate-limit.js'

export interface EmailVerificationRepository {
  getStatus(userId: string): Promise<EmailVerificationStatus | null>
  request(userId: string, tokenHash: string, expiresAt: Date): Promise<void>
  confirm(userId: string, tokenHash: string): Promise<boolean>
}

export interface EmailVerificationSender {
  sendEmailVerificationEmail(command: {
    email: string
    code: string
  }): Promise<void>
}

export class EmailVerificationService {
  constructor(
    private readonly repository: EmailVerificationRepository,
    private readonly sender: EmailVerificationSender,
    private readonly limiter: RateLimiter,
  ) {}

  async getStatus(userId: string): Promise<EmailVerificationStatus> {
    const status = await this.repository.getStatus(userId)
    if (!status)
      throw new HttpError(404, 'user_profile_not_found', 'User not found.')
    return status
  }

  async isVerified(userId: string): Promise<boolean> {
    return (await this.repository.getStatus(userId))?.verified === true
  }

  async request(userId: string, address: string): Promise<void> {
    await this.consumeLimits('request', userId, address, 3, 30)
    const status = await this.getStatus(userId)
    if (status.verified) return
    const code = randomBytes(6).toString('hex').toUpperCase()
    await this.repository.request(
      userId,
      hashCode(userId, code),
      new Date(Date.now() + 30 * 60_000),
    )
    await this.sender.sendEmailVerificationEmail({
      email: status.email,
      code: code.match(/.{4}/g)!.join('-'),
    })
  }

  async confirm(
    userId: string,
    code: string,
    address: string,
  ): Promise<EmailVerificationStatus> {
    await this.consumeLimits('confirm', userId, address, 10, 50)
    const normalized = code.replace(/[\s-]/g, '').toUpperCase()
    if (
      !/^[A-F0-9]{12}$/.test(normalized) ||
      !(await this.repository.confirm(userId, hashCode(userId, normalized)))
    ) {
      throw new HttpError(
        400,
        'email_verification_code_invalid',
        'Код неверен или истёк. Запросите новый код.',
      )
    }
    return this.getStatus(userId)
  }

  private async consumeLimits(
    action: string,
    userId: string,
    address: string,
    accountLimit: number,
    ipLimit: number,
  ) {
    await Promise.all([
      this.limiter.consume({
        key: `email-verification:${action}:user:${userId}`,
        limit: accountLimit,
        windowMs: 60 * 60_000,
      }),
      this.limiter.consume({
        key: `email-verification:${action}:ip:${address}`,
        limit: ipLimit,
        windowMs: 60 * 60_000,
      }),
    ])
  }
}

function hashCode(userId: string, code: string): string {
  return createHash('sha256').update(`${userId}:${code}`).digest('hex')
}
