import {
  cleaningAssigneeSchema,
  cleaningDepthSchema,
  cleaningEnergySchema,
  cleaningFrequencyTypeSchema,
  cleaningPostponeModeSchema,
  cleaningPrioritySchema,
  cleaningTaskHistoryActionSchema,
} from '@planner/contracts'
import type { OpenAPIV3 } from 'openapi-types'

import {
  nullableStringSchema,
  positiveIntegerSchema,
} from './openapi-helpers.js'

type SchemaProperties = NonNullable<OpenAPIV3.SchemaObject['properties']>

export function createCleaningContractSchemas(): Record<
  string,
  OpenAPIV3.SchemaObject
> {
  return {
    CleaningListResponse: objectSchema({
      history: arrayOfRef('CleaningTaskHistoryItemRecord'),
      states: arrayOfRef('CleaningTaskStateRecord'),
      tasks: arrayOfRef('CleaningTaskRecord'),
      zones: arrayOfRef('CleaningZoneRecord'),
    }),
    CleaningSummary: objectSchema({
      accumulatedCount: nonnegativeIntegerSchema(),
      activeZoneCount: nonnegativeIntegerSchema(),
      completedTodayCount: nonnegativeIntegerSchema(),
      dueCount: nonnegativeIntegerSchema(),
      quickCount: nonnegativeIntegerSchema(),
      seasonalCount: nonnegativeIntegerSchema(),
      urgentCount: nonnegativeIntegerSchema(),
    }),
    CleaningTaskActionInput: objectSchema(
      {
        date: stringSchema(),
        mode: {
          ...enumSchema(cleaningPostponeModeSchema.options),
          default: 'next_cycle',
        },
        note: {
          default: '',
          maxLength: 500,
          type: 'string',
        },
        targetDate: {
          ...nullableStringSchema(),
          default: null,
        },
      },
      [],
    ),
    CleaningTaskActionResponse: objectSchema({
      historyItem: ref('CleaningTaskHistoryItemRecord'),
      state: ref('CleaningTaskStateRecord'),
    }),
    CleaningTaskHistoryItemRecord: objectSchema({
      action: enumSchema(cleaningTaskHistoryActionSchema.options),
      createdAt: stringSchema(),
      date: stringSchema(),
      id: stringSchema(),
      note: stringSchema(),
      targetDate: nullableStringSchema(),
      taskId: stringSchema(),
      userId: stringSchema(),
      workspaceId: stringSchema(),
      zoneId: stringSchema(),
    }),
    CleaningTaskRecord: objectSchema({
      assignee: enumSchema(cleaningAssigneeSchema.options),
      createdAt: stringSchema(),
      customIntervalDays: nullablePositiveIntegerSchema(),
      deletedAt: nullableStringSchema(),
      depth: enumSchema(cleaningDepthSchema.options),
      description: stringSchema(),
      energy: enumSchema(cleaningEnergySchema.options),
      estimatedMinutes: nullablePositiveIntegerSchema(),
      frequencyInterval: positiveIntegerSchema(),
      frequencyType: enumSchema(cleaningFrequencyTypeSchema.options),
      id: stringSchema(),
      impactScore: integerRangeSchema(1, 5),
      isActive: booleanSchema(),
      isSeasonal: booleanSchema(),
      priority: enumSchema(cleaningPrioritySchema.options),
      seasonMonths: monthArraySchema(),
      sortOrder: integerSchema(),
      tags: stringArraySchema(),
      title: {
        minLength: 1,
        type: 'string',
      },
      updatedAt: stringSchema(),
      userId: stringSchema(),
      version: positiveIntegerSchema(),
      workspaceId: stringSchema(),
      zoneId: stringSchema(),
    }),
    CleaningTaskStateRecord: objectSchema({
      lastCompletedAt: nullableStringSchema(),
      lastPostponedAt: nullableStringSchema(),
      lastSkippedAt: nullableStringSchema(),
      nextDueAt: nullableStringSchema(),
      postponeCount: nonnegativeIntegerSchema(),
      taskId: stringSchema(),
      updatedAt: stringSchema(),
      version: positiveIntegerSchema(),
      workspaceId: stringSchema(),
    }),
    CleaningTaskUpdateInput: objectSchema(
      {
        assignee: enumSchema(cleaningAssigneeSchema.options),
        customIntervalDays: nullablePositiveIntegerSchema(),
        depth: enumSchema(cleaningDepthSchema.options),
        description: {
          maxLength: 800,
          type: 'string',
        },
        energy: enumSchema(cleaningEnergySchema.options),
        estimatedMinutes: nullablePositiveIntegerSchema(),
        expectedVersion: positiveIntegerSchema(),
        frequencyInterval: positiveIntegerSchema(),
        frequencyType: enumSchema(cleaningFrequencyTypeSchema.options),
        impactScore: integerRangeSchema(1, 5),
        isActive: booleanSchema(),
        isSeasonal: booleanSchema(),
        priority: enumSchema(cleaningPrioritySchema.options),
        seasonMonths: monthArraySchema(),
        sortOrder: integerSchema(),
        tags: stringArraySchema(),
        title: {
          maxLength: 140,
          minLength: 1,
          type: 'string',
        },
        zoneId: {
          minLength: 1,
          type: 'string',
        },
      },
      [],
    ),
    CleaningTaskWithState: objectSchema({
      isDue: booleanSchema(),
      isOverdue: booleanSchema(),
      score: {
        type: 'number',
      },
      state: ref('CleaningTaskStateRecord'),
      task: ref('CleaningTaskRecord'),
      zone: ref('CleaningZoneRecord'),
    }),
    CleaningTodayResponse: objectSchema({
      accumulatedItems: arrayOfRef('CleaningTaskWithState'),
      date: stringSchema(),
      dayOfWeek: integerRangeSchema(1, 7),
      history: arrayOfRef('CleaningTaskHistoryItemRecord'),
      items: arrayOfRef('CleaningTaskWithState'),
      quickItems: arrayOfRef('CleaningTaskWithState'),
      seasonalItems: arrayOfRef('CleaningTaskWithState'),
      summary: ref('CleaningSummary'),
      urgentItems: arrayOfRef('CleaningTaskWithState'),
      zones: arrayOfRef('CleaningZoneRecord'),
    }),
    CleaningZoneRecord: objectSchema({
      createdAt: stringSchema(),
      dayOfWeek: integerRangeSchema(1, 7),
      deletedAt: nullableStringSchema(),
      description: stringSchema(),
      id: stringSchema(),
      isActive: booleanSchema(),
      sortOrder: integerSchema(),
      title: {
        minLength: 1,
        type: 'string',
      },
      updatedAt: stringSchema(),
      userId: stringSchema(),
      version: positiveIntegerSchema(),
      workspaceId: stringSchema(),
    }),
    CleaningZoneUpdateInput: objectSchema(
      {
        dayOfWeek: integerRangeSchema(1, 7),
        description: {
          maxLength: 600,
          type: 'string',
        },
        expectedVersion: positiveIntegerSchema(),
        isActive: booleanSchema(),
        sortOrder: integerSchema(),
        title: {
          maxLength: 80,
          minLength: 1,
          type: 'string',
        },
      },
      [],
    ),
    NewCleaningTaskInput: objectSchema(
      {
        assignee: {
          ...enumSchema(cleaningAssigneeSchema.options),
          default: 'anyone',
        },
        customIntervalDays: nullablePositiveIntegerSchema(),
        depth: {
          ...enumSchema(cleaningDepthSchema.options),
          default: 'regular',
        },
        description: {
          default: '',
          maxLength: 800,
          type: 'string',
        },
        energy: {
          ...enumSchema(cleaningEnergySchema.options),
          default: 'normal',
        },
        estimatedMinutes: nullablePositiveIntegerSchema(),
        frequencyInterval: {
          ...positiveIntegerSchema(),
          default: 1,
        },
        frequencyType: {
          ...enumSchema(cleaningFrequencyTypeSchema.options),
          default: 'weekly',
        },
        id: stringSchema(),
        impactScore: {
          ...integerRangeSchema(1, 5),
          default: 3,
        },
        isActive: {
          default: true,
          type: 'boolean',
        },
        isSeasonal: {
          default: false,
          type: 'boolean',
        },
        priority: {
          ...enumSchema(cleaningPrioritySchema.options),
          default: 'normal',
        },
        seasonMonths: {
          ...monthArraySchema(),
          default: [],
        },
        sortOrder: integerSchema(),
        tags: {
          ...stringArraySchema(),
          default: [],
          maxItems: 12,
        },
        title: {
          maxLength: 140,
          minLength: 1,
          type: 'string',
        },
        zoneId: {
          minLength: 1,
          type: 'string',
        },
      },
      ['title', 'zoneId'],
    ),
    NewCleaningZoneInput: objectSchema(
      {
        dayOfWeek: integerRangeSchema(1, 7),
        description: {
          default: '',
          maxLength: 600,
          type: 'string',
        },
        id: stringSchema(),
        isActive: {
          default: true,
          type: 'boolean',
        },
        sortOrder: integerSchema(),
        title: {
          maxLength: 80,
          minLength: 1,
          type: 'string',
        },
      },
      ['dayOfWeek', 'title'],
    ),
  }
}

function objectSchema(
  properties: SchemaProperties,
  required = Object.keys(properties),
): OpenAPIV3.SchemaObject {
  const schema: OpenAPIV3.SchemaObject = {
    additionalProperties: false,
    properties,
    type: 'object',
  }

  if (required.length > 0) {
    schema.required = required
  }

  return schema
}

function arrayOfRef(schemaName: string): OpenAPIV3.SchemaObject {
  return {
    items: ref(schemaName),
    type: 'array',
  }
}

function booleanSchema(): OpenAPIV3.SchemaObject {
  return {
    type: 'boolean',
  }
}

function enumSchema(values: readonly string[]): OpenAPIV3.SchemaObject {
  return {
    enum: [...values],
    type: 'string',
  }
}

function integerRangeSchema(
  minimum: number,
  maximum: number,
): OpenAPIV3.SchemaObject {
  return {
    maximum,
    minimum,
    type: 'integer',
  }
}

function integerSchema(): OpenAPIV3.SchemaObject {
  return {
    type: 'integer',
  }
}

function monthArraySchema(): OpenAPIV3.SchemaObject {
  return {
    items: integerRangeSchema(1, 12),
    maxItems: 12,
    type: 'array',
  }
}

function nonnegativeIntegerSchema(): OpenAPIV3.SchemaObject {
  return {
    minimum: 0,
    type: 'integer',
  }
}

function nullablePositiveIntegerSchema(): OpenAPIV3.SchemaObject {
  return {
    ...positiveIntegerSchema(),
    nullable: true,
  }
}

function ref(schemaName: string): OpenAPIV3.ReferenceObject {
  return {
    $ref: `#/components/schemas/${schemaName}`,
  }
}

function stringArraySchema(): OpenAPIV3.SchemaObject {
  return {
    items: stringSchema(),
    type: 'array',
  }
}

function stringSchema(): OpenAPIV3.SchemaObject {
  return {
    type: 'string',
  }
}
