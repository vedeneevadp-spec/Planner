import nodemailer from 'nodemailer'

import type { PlannerAuthRuntimeConfig } from './auth.model.js'

export interface SendPasswordResetEmailCommand {
  email: string
  resetUrl: string
}

export interface AuthEmailSender {
  sendPasswordResetEmail: (
    command: SendPasswordResetEmailCommand,
  ) => Promise<void>
}

export class NoopAuthEmailSender implements AuthEmailSender {
  constructor(private readonly appEnv: string) {}

  sendPasswordResetEmail(
    command: SendPasswordResetEmailCommand,
  ): Promise<void> {
    if (this.appEnv === 'production') {
      console.warn(
        '[auth] SMTP is not configured. Password reset email was not sent.',
      )

      return Promise.resolve()
    }

    console.warn(
      `[auth] SMTP is not configured. Password reset link for ${command.email}: ${command.resetUrl}`,
    )

    return Promise.resolve()
  }
}

export class SmtpAuthEmailSender implements AuthEmailSender {
  private readonly transporter

  constructor(private readonly config: PlannerAuthRuntimeConfig) {
    this.transporter = nodemailer.createTransport({
      auth: config.smtp?.user
        ? {
            pass: config.smtp.password,
            user: config.smtp.user,
          }
        : undefined,
      host: config.smtp?.host,
      port: config.smtp?.port,
      secure: config.smtp?.secure,
    })
  }

  async sendPasswordResetEmail(
    command: SendPasswordResetEmailCommand,
  ): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.emailFrom,
      html: createPasswordResetHtml(command.resetUrl),
      subject: 'Восстановление доступа к Chaotika',
      text: createPasswordResetText(command.resetUrl),
      to: command.email,
    })
  }
}

function createPasswordResetText(resetUrl: string): string {
  return [
    'Вы запросили восстановление доступа к Chaotika.',
    '',
    'Чтобы задать новый пароль, откройте ссылку:',
    resetUrl,
    '',
    'Если вы не запрашивали восстановление, просто проигнорируйте это письмо.',
  ].join('\n')
}

function createPasswordResetHtml(resetUrl: string): string {
  const escapedResetUrl = escapeHtml(resetUrl)

  return [
    '<p>Вы запросили восстановление доступа к Chaotika.</p>',
    `<p><a href="${escapedResetUrl}">Задать новый пароль</a></p>`,
    '<p>Если вы не запрашивали восстановление, просто проигнорируйте это письмо.</p>',
  ].join('')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
