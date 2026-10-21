import assert from 'node:assert/strict'
import { createServer, type Socket } from 'node:net'
import { test } from 'node:test'

import { SmtpAuthEmailSender } from './auth.email.js'
import type { PlannerAuthRuntimeConfig } from './auth.model.js'

void test(
  'delivers a password reset email through SMTP with usable text and HTML links',
  { timeout: 5_000 },
  async (context) => {
    const smtp = await startSmtpServer()
    context.after(smtp.close)
    const sender = new SmtpAuthEmailSender(createConfig(smtp.port))
    const resetUrl =
      'https://planner.example.test/?reset_token=test-token&source=email'

    await sender.sendPasswordResetEmail({
      email: 'recipient@example.test',
      resetUrl,
    })

    assert.ok(smtp.commands.includes('MAIL FROM:<planner@example.test>'))
    assert.ok(smtp.commands.includes('RCPT TO:<recipient@example.test>'))
    assert.equal(smtp.messages.length, 1)
    const message = smtp.messages[0] ?? ''
    assert.match(message, /^From: planner@example\.test\r?$/m)
    assert.match(message, /^To: recipient@example\.test\r?$/m)
    assert.ok(readMimePart(message, 'plain').includes(resetUrl))
    assert.ok(
      readMimePart(message, 'html').includes(
        'href="https://planner.example.test/?reset_token=test-token&amp;source=email"',
      ),
    )
  },
)

void test(
  'rejects a password reset send when the SMTP server refuses the recipient',
  { timeout: 5_000 },
  async (context) => {
    const smtp = await startSmtpServer(true)
    context.after(smtp.close)
    const sender = new SmtpAuthEmailSender(createConfig(smtp.port))

    await assert.rejects(
      sender.sendPasswordResetEmail({
        email: 'recipient@example.test',
        resetUrl: 'https://planner.example.test/?reset_token=test-token',
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.equal('code' in error && error.code, 'EENVELOPE')
        assert.equal('responseCode' in error && error.responseCode, 550)
        return true
      },
    )
    assert.equal(smtp.messages.length, 0)
    assert.equal(smtp.commands.includes('DATA'), false)
  },
)

async function startSmtpServer(rejectRecipient = false) {
  const commands: string[] = []
  const messages: string[] = []
  const connections = new Set<Socket>()
  const server = createServer((socket) => {
    connections.add(socket)
    socket.setEncoding('utf8')
    socket.on('close', () => connections.delete(socket))
    let buffer = ''
    let receivingMessage = false

    socket.on('data', (chunk: string) => {
      buffer += chunk
      while (true) {
        if (receivingMessage) {
          const end = buffer.indexOf('\r\n.\r\n')
          if (end < 0) return
          messages.push(buffer.slice(0, end))
          buffer = buffer.slice(end + 5)
          receivingMessage = false
          socket.write('250 Message accepted\r\n')
          continue
        }

        const end = buffer.indexOf('\r\n')
        if (end < 0) return
        const command = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        commands.push(command)
        if (/^(EHLO|HELO) /.test(command)) {
          socket.write('250 localhost\r\n')
        } else if (command.startsWith('MAIL FROM:')) {
          socket.write('250 Sender accepted\r\n')
        } else if (command.startsWith('RCPT TO:')) {
          socket.write(
            rejectRecipient
              ? '550 Recipient rejected\r\n'
              : '250 Recipient accepted\r\n',
          )
        } else if (command === 'DATA') {
          receivingMessage = true
          socket.write('354 End data with <CRLF>.<CRLF>\r\n')
        } else if (command === 'QUIT') {
          socket.end('221 Bye\r\n')
        } else {
          socket.write('500 Unexpected command\r\n')
        }
      }
    })
    socket.write('220 localhost ESMTP test\r\n')
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address !== 'string')

  return {
    commands,
    messages,
    port: address.port,
    close: async () => {
      for (const connection of connections) connection.destroy()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

function readMimePart(message: string, type: 'plain' | 'html') {
  const boundary = /boundary="([^"]+)"/.exec(message)?.[1]
  assert.ok(boundary)
  const part = message
    .split(`--${boundary}`)
    .find((value) => value.includes(`Content-Type: text/${type};`))
  assert.ok(part)
  const separator = part.indexOf('\r\n\r\n')
  assert.ok(separator >= 0)
  const headers = part.slice(0, separator)
  const body = part.slice(separator + 4).trim()
  if (headers.includes('Content-Transfer-Encoding: base64')) {
    return Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8')
  }
  assert.match(headers, /Content-Transfer-Encoding: quoted-printable/)
  return body
    .replace(/=\r\n/g, '')
    .replace(/=([\dA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
}

function createConfig(port: number): PlannerAuthRuntimeConfig {
  return {
    accessTokenTtlSeconds: 900,
    emailFrom: 'planner@example.test',
    jwt: {
      audience: 'planner-test',
      issuer: 'planner-test',
      secret: 'test-secret-that-is-long-enough-for-auth-service',
    },
    passwordResetTtlSeconds: 900,
    publicAppUrl: 'https://planner.example.test',
    refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
    smtp: { host: '127.0.0.1', port, secure: false },
  }
}
