import { z } from 'zod'

export const googleAuthConfigSchema = z.object({
  clientId: z.string().min(1).nullable(),
})

export const googleAuthChallengeSchema = z.object({
  challengeToken: z.string().min(1),
  clientId: z.string().min(1),
  expiresAt: z.string().datetime(),
  nonce: z.string().min(1),
})

export const googleAuthSignInInputSchema = z.object({
  challengeToken: z.string().min(1).max(4096),
  currentPassword: z.string().min(1).max(128).optional(),
  idToken: z.string().min(1).max(16384),
})

export type GoogleAuthChallenge = z.infer<typeof googleAuthChallengeSchema>
export type GoogleAuthSignInInput = z.infer<typeof googleAuthSignInInputSchema>
