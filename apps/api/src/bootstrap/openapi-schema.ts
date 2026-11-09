import {
  chaosInboxItemSchema,
  routineTaskSchema,
  selfCareItemScheduleInputSchema,
  selfCareItemUpdateInputSchema,
  selfCareRitualStepDraftSchema,
  taskRecurrenceSchema,
  taskSchema,
  taskTemplateSchema,
} from '@planner/contracts'
import type { OpenAPIV3 } from 'openapi-types'
import { z } from 'zod'

const normalizedOutputs = new Map<z.core.$ZodType, z.core.$ZodType>()

// These transforms only fill missing scalars, trim strings, or sort/deduplicate
// arrays. Their output retains the input constraints, but is no longer optional.
// Unknown transforms must fail generation instead of silently becoming `any`.
for (const schema of [
  chaosInboxItemSchema.shape.sphereId,
  selfCareItemScheduleInputSchema.shape.currency,
  selfCareItemScheduleInputSchema.shape.reminderOffsetsMinutes,
  selfCareItemUpdateInputSchema.shape.defaultDurationMinutes,
  selfCareItemUpdateInputSchema.shape.exerciseDetails.unwrap().unwrap().shape
    .plannedValue,
  selfCareRitualStepDraftSchema.shape.stepIds,
  taskSchema.shape.assigneeDisplayName,
  taskSchema.shape.icon,
  taskSchema.shape.reminderOffsets,
  taskRecurrenceSchema.shape.daysOfWeek,
  routineTaskSchema.shape.daysOfWeek,
  taskSchema.shape.resource,
  taskSchema.shape.requiresConfirmation,
  taskTemplateSchema.shape.projectId,
]) {
  let current: z.core.$ZodType = schema
  while (current instanceof z.ZodOptional || current instanceof z.ZodDefault) {
    current = current.unwrap()
  }
  if (!(current instanceof z.ZodPipe)) {
    throw new Error('Expected a documented normalization transform')
  }
  const input = current.in
  normalizedOutputs.set(
    current.out,
    input instanceof z.ZodOptional ? input.unwrap() : input,
  )
}

export function contractSchema(
  schema: z.ZodType,
  io: 'input' | 'output',
): OpenAPIV3.SchemaObject {
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: ({ zodSchema }) => {
      const output = normalizedOutputs.get(zodSchema)
      if (!output) return 'throw'
      return z.toJSONSchema(output, { target: 'openapi-3.0', io: 'output' })
    },
  }) as OpenAPIV3.SchemaObject
}

export function contractQueryParameters(
  schema: z.ZodType,
): OpenAPIV3.ParameterObject[] {
  const json = contractSchema(schema, 'input')
  return Object.entries(json.properties ?? {}).map(([name, value]) => ({
    name,
    in: 'query',
    required: json.required?.includes(name) ?? false,
    schema: value,
  }))
}
