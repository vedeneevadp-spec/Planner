import { z } from 'zod'

export const emailVerificationStatusSchema = z.object({
  email: z.email(),
  verified: z.boolean(),
})

export const emailVerificationConfirmInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Fa-f0-9\s-]{12,24}$/),
})

export type EmailVerificationStatus = z.infer<
  typeof emailVerificationStatusSchema
>
