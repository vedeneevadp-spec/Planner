import { z } from 'zod'

export const googlePlayTestingInputSchema = z.object({
  googleEmail: z.string().trim().toLowerCase().email().max(254),
})
export const googlePlayTestingRequestSchema = z.object({
  userId: z.string().uuid(),
  googleEmail: z.string().email(),
  status: z.enum(['pending', 'invited']),
  revision: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
})
export const googlePlayTestingSettingsSchema = z.object({
  isOpen: z.boolean(),
})
export const googlePlayTestingStateSchema =
  googlePlayTestingSettingsSchema.extend({
    request: googlePlayTestingRequestSchema.nullable(),
    invitation: z
      .object({ joinUrl: z.string().url(), downloadUrl: z.string().url() })
      .nullable(),
  })
export const googlePlayTestingAdminSchema =
  googlePlayTestingSettingsSchema.extend({
    requests: z.array(googlePlayTestingRequestSchema),
  })
export const googlePlayTestingReviewSchema = z.object({
  status: z.enum(['pending', 'invited']),
  revision: z.number().int().positive(),
})
export type GooglePlayTestingRequest = z.infer<
  typeof googlePlayTestingRequestSchema
>
export type GooglePlayTestingState = z.infer<
  typeof googlePlayTestingStateSchema
>
export type GooglePlayTestingReview = z.infer<
  typeof googlePlayTestingReviewSchema
>
