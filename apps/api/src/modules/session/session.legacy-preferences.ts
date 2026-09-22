import {
  type SessionResponse,
  type UserPreferences,
  userPreferencesUpdateInputSchema,
  type WorkspaceSettings,
  workspaceSettingsUpdateInputSchema,
} from '@planner/contracts'
import { z } from 'zod'

// Older clients default a missing voiceAssistantEnabled to true. Keep these
// disabled wire values until clients with that default are no longer supported.
// They are deliberately absent from the domain model and stored preferences.
export function withLegacyUserPreferences(preferences: UserPreferences) {
  return { ...preferences, voiceAssistantEnabled: false as const }
}

export function withLegacyWorkspaceSettings(settings: WorkspaceSettings) {
  return { ...settings, wakeWordTrainingModeEnabled: false as const }
}

export function withLegacySessionPreferences(session: SessionResponse) {
  return {
    ...session,
    userPreferences: withLegacyUserPreferences(session.userPreferences),
    workspaceSettings: withLegacyWorkspaceSettings(session.workspaceSettings),
  }
}

export const legacyUserPreferencesUpdateInputSchema = z
  .object({
    ...userPreferencesUpdateInputSchema.shape,
    voiceAssistantEnabled: z.boolean().optional(),
  })
  .refine(
    (value) => Object.values(value).some((setting) => setting !== undefined),
    'At least one preference must be updated.',
  )
  .transform((value) => {
    const { voiceAssistantEnabled: _retiredSetting, ...preferences } = value

    return preferences
  })

export const legacyWorkspaceSettingsUpdateInputSchema = z
  .object({
    ...workspaceSettingsUpdateInputSchema.shape,
    wakeWordTrainingModeEnabled: z.boolean().optional(),
  })
  .transform((value) => {
    const { wakeWordTrainingModeEnabled: _retiredSetting, ...settings } = value

    return settings
  })
