import type {
  AuthCredentialRecord,
  AuthSessionTokenRecord,
  AuthUserRecord,
  CompletePasswordResetCommand,
  CreateAuthUserCommand,
  CreatePasswordResetTokenCommand,
  CreateRefreshTokenCommand,
  CreateRefreshTokenPayload,
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
  createUserWithCredential: (
    command: CreateAuthUserCommand,
  ) => Promise<AuthUserRecord>
  findCredentialByEmail: (email: string) => Promise<AuthCredentialRecord | null>
  findCredentialByUserId: (
    userId: string,
  ) => Promise<AuthCredentialRecord | null>
  findUserByEmail: (email: string) => Promise<AuthUserRecord | null>
  revokeRefreshToken: (refreshTokenHash: string) => Promise<void>
  rotateRefreshToken: (
    currentRefreshTokenHash: string,
    nextRefreshToken: CreateRefreshTokenPayload,
  ) => Promise<AuthSessionTokenRecord | null>
  updatePassword: (command: UpdatePasswordCommand) => Promise<void>
}
