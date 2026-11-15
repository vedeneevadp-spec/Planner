import nodemailer from 'nodemailer'

import { HttpError } from '../../bootstrap/http-error.js'
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

  sendEmailVerificationEmail(): Promise<void> {
    return Promise.reject(
      new HttpError(
        503,
        'email_delivery_unavailable',
        'Отправка почты пока недоступна. Попробуйте позже.',
      ),
    )
  }

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

  async sendEmailVerificationEmail(command: {
    email: string
    code: string
  }): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.emailFrom,
      to: command.email,
      subject: 'Подтверждение почты в Chaotika',
      text: `Ваш код подтверждения: ${command.code}\n\nВведите его в профиле Chaotika в течение 30 минут. Не сообщайте код другим людям. Если вы не запрашивали код, проигнорируйте письмо.`,
      html: `<p>Ваш код подтверждения: <strong>${escapeHtml(command.code)}</strong></p><p>Введите его в профиле Chaotika в течение 30 минут. Не сообщайте код другим людям. Если вы не запрашивали код, проигнорируйте письмо.</p>`,
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
