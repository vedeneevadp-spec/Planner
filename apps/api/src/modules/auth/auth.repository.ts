import type {
  AuthCredentialRecord,
  AuthSessionTokenRecord,
  AuthUserRecord,
  CompletePasswordResetCommand,
  CreateAuthUserCommand,
  CreateOAuthAuthorizationCodeCommand,
  CreatePasswordResetTokenCommand,
  CreateRefreshTokenCommand,
  ExchangeOAuthAuthorizationCodeCommand,
  RotateRefreshTokenPayload,
  UpdatePasswordCommand,
} from './auth.model.js'

export interface AuthRepository {
  completePasswordReset: (
    command: CompletePasswordResetCommand,
  ) => Promise<AuthSessionTokenRecord | null>
  createPasswordResetToken: (
    command: CreatePasswordResetTokenCommand,
  ) => Promise<void>
  createRefreshToken: (command: CreateRefreshTokenCommand) => Promise<void>
  createOAuthAuthorizationCode: (
    command: CreateOAuthAuthorizationCodeCommand,
  ) => Promise<void>
  createUserWithCredential: (
    command: CreateAuthUserCommand,
  ) => Promise<AuthUserRecord>
  exchangeOAuthAuthorizationCode: (
    command: ExchangeOAuthAuthorizationCodeCommand,
  ) => Promise<AuthSessionTokenRecord | null>
  findCredentialByEmail: (email: string) => Promise<AuthCredentialRecord | null>
  findCredentialByUserId: (
    userId: string,
  ) => Promise<AuthCredentialRecord | null>
  findUserByEmail: (email: string) => Promise<AuthUserRecord | null>
  revokeRefreshToken: (refreshTokenHash: string) => Promise<void>
  rotateRefreshToken: (
    currentRefreshTokenHash: string,
    nextRefreshToken: RotateRefreshTokenPayload,
  ) => Promise<AuthSessionTokenRecord | null>
  updatePassword: (command: UpdatePasswordCommand) => Promise<void>
}
