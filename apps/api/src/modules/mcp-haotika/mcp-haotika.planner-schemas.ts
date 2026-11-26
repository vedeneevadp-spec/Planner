import {
  publicShoppingCreateSchema,
  publicShoppingListSchema,
  publicShoppingUpdateSchema,
  publicTaskCreateSchema,
  publicTaskListSchema,
  publicTaskUpdateSchema,
  uuidV7Schema,
} from '@planner/contracts'
import { z } from 'zod'

const idSchema = z
  .string()
  .uuid()
  .describe(
    'Exact ID returned by a list, get or create tool. Never guess an existing ID.',
  )
const creationIdSchema = uuidV7Schema.describe(
  'A fresh UUIDv7 for this creation. Generate it once and reuse it with identical arguments when retrying; never reuse an existing record ID.',
)
const versionSchema = z
  .number()
  .int()
  .positive()
  .describe(
    'Version from the latest get_task result. On CONFLICT, reread the task and reconsider the change.',
  )
const plannedStartTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
  .nullable()
  .optional()
  .describe(
    'Local start in the user’s planner time zone, HH:mm (00:00–23:59). Requires a planned date. Omit to keep the time on update, or pass null to clear it.',
  )

export const plannerToolInputSchemas = {
  list_tasks: publicTaskListSchema.safeExtend({
    limit: z.number().int().min(1).max(100).default(30),
    offset: z.number().int().nonnegative().default(0),
  }),
  get_task: z.object({ id: idSchema }).strict(),
  create_task: publicTaskCreateSchema.safeExtend({
    id: creationIdSchema,
    plannedStartTime: plannedStartTimeSchema,
  }),
  update_task: publicTaskUpdateSchema
    .safeExtend({
      id: idSchema,
      expectedVersion: versionSchema,
      plannedStartTime: plannedStartTimeSchema,
    })
    .refine(
      (value) =>
        Object.keys(value).some(
          (key) => key !== 'id' && key !== 'expectedVersion',
        ),
      'Provide at least one field to update.',
    ),
  complete_task: z
    .object({ id: idSchema, expectedVersion: versionSchema })
    .strict(),
  list_shopping: publicShoppingListSchema.safeExtend({
    limit: z.number().int().min(1).max(100).default(30),
    page: z.number().int().positive().default(1),
  }),
  get_shopping_item: z.object({ id: idSchema }).strict(),
  create_shopping_item: publicShoppingCreateSchema.safeExtend({
    id: creationIdSchema,
  }),
  update_shopping_item: publicShoppingUpdateSchema
    .safeExtend({ id: idSchema })
    .refine(
      (value) => Object.keys(value).some((key) => key !== 'id'),
      'Provide at least one field to update.',
    ),
  complete_shopping_item: z.object({ id: idSchema }).strict(),
}

export type PlannerToolName = keyof typeof plannerToolInputSchemas

function inputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'input' })
}

export const plannerJsonSchemas = {
  list_tasks: inputJsonSchema(plannerToolInputSchemas.list_tasks),
  get_task: inputJsonSchema(plannerToolInputSchemas.get_task),
  create_task: inputJsonSchema(plannerToolInputSchemas.create_task),
  update_task: inputJsonSchema(plannerToolInputSchemas.update_task),
  complete_task: inputJsonSchema(plannerToolInputSchemas.complete_task),
  list_shopping: inputJsonSchema(plannerToolInputSchemas.list_shopping),
  get_shopping_item: inputJsonSchema(plannerToolInputSchemas.get_shopping_item),
  create_shopping_item: inputJsonSchema(
    plannerToolInputSchemas.create_shopping_item,
  ),
  update_shopping_item: inputJsonSchema(
    plannerToolInputSchemas.update_shopping_item,
  ),
  complete_shopping_item: inputJsonSchema(
    plannerToolInputSchemas.complete_shopping_item,
  ),
} satisfies Record<PlannerToolName, Record<string, unknown>>
