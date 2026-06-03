import {
  cleaningAssigneeSchema,
  cleaningDepthSchema,
  cleaningEnergySchema,
  cleaningFrequencyTypeSchema,
  cleaningPostponeModeSchema,
  cleaningPrioritySchema,
  cleaningTaskHistoryActionSchema,
  cleaningTaskScopeSchema,
  habitEntryStatusSchema,
  habitFrequencySchema,
  habitTargetTypeSchema,
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
      generalCount: nonnegativeIntegerSchema(),
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
      zoneId: nullableStringSchema(),
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
      scope: enumSchema(cleaningTaskScopeSchema.options),
      tags: stringArraySchema(),
      title: {
        minLength: 1,
        type: 'string',
      },
      updatedAt: stringSchema(),
      userId: stringSchema(),
      version: positiveIntegerSchema(),
      workspaceId: stringSchema(),
      zoneId: nullableStringSchema(),
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
        scope: enumSchema(cleaningTaskScopeSchema.options),
        tags: stringArraySchema(),
        title: {
          maxLength: 140,
          minLength: 1,
          type: 'string',
        },
        zoneId: nullableStringSchema(),
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
      zone: nullableRef('CleaningZoneRecord'),
    }),
    CleaningTodayResponse: objectSchema({
      accumulatedItems: arrayOfRef('CleaningTaskWithState'),
      date: stringSchema(),
      dayOfWeek: integerRangeSchema(1, 7),
      generalItems: arrayOfRef('CleaningTaskWithState'),
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
        scope: {
          ...enumSchema(cleaningTaskScopeSchema.options),
          default: 'zone',
        },
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
        zoneId: nullableStringSchema(),
      },
      ['title'],
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

export function createHabitContractSchemas(): Record<
  string,
  OpenAPIV3.SchemaObject
> {
  return {
    HabitEntryDeleteInput: objectSchema(
      {
        expectedVersion: positiveIntegerSchema(),
      },
      [],
    ),
    HabitEntryRecord: objectSchema(
      {
        createdAt: stringSchema(),
        date: stringSchema(),
        deletedAt: nullableStringSchema(),
        habitId: stringSchema(),
        id: stringSchema(),
        note: stringSchema(),
        status: enumSchema(habitEntryStatusSchema.options),
        targetValue: positiveIntegerSchema(),
        updatedAt: stringSchema(),
        userId: stringSchema(),
        value: nonnegativeIntegerSchema(),
        version: positiveIntegerSchema(),
        workspaceId: stringSchema(),
      },
      [
        'createdAt',
        'date',
        'deletedAt',
        'habitId',
        'id',
        'note',
        'status',
        'updatedAt',
        'userId',
        'value',
        'version',
        'workspaceId',
      ],
    ),
    HabitEntryUpsertInput: objectSchema(
      {
        date: stringSchema(),
        expectedVersion: positiveIntegerSchema(),
        note: {
          default: '',
          maxLength: 500,
          type: 'string',
        },
        status: {
          ...enumSchema(habitEntryStatusSchema.options),
          default: 'done',
        },
        value: nonnegativeIntegerSchema(),
      },
      ['date'],
    ),
    HabitListResponse: arrayOfRef('HabitRecord'),
    HabitRecord: objectSchema({
      color: {
        minLength: 1,
        type: 'string',
      },
      createdAt: stringSchema(),
      daysOfWeek: weekdayArraySchema(),
      deletedAt: nullableStringSchema(),
      description: stringSchema(),
      endDate: nullableStringSchema(),
      frequency: enumSchema(habitFrequencySchema.options),
      icon: {
        minLength: 1,
        type: 'string',
      },
      id: stringSchema(),
      isActive: booleanSchema(),
      reminderTime: nullableTimeStringSchema(),
      sortOrder: integerSchema(),
      sphereId: nullableStringSchema(),
      startDate: stringSchema(),
      targetType: enumSchema(habitTargetTypeSchema.options),
      targetValue: positiveIntegerSchema(),
      title: {
        minLength: 1,
        type: 'string',
      },
      unit: stringSchema(),
      updatedAt: stringSchema(),
      userId: stringSchema(),
      version: positiveIntegerSchema(),
      workspaceId: stringSchema(),
    }),
    HabitStats: objectSchema({
      bestStreak: nonnegativeIntegerSchema(),
      completionRate: integerRangeSchema(0, 100),
      completedCount: nonnegativeIntegerSchema(),
      currentStreak: nonnegativeIntegerSchema(),
      habitId: stringSchema(),
      lastCompletedDate: nullableStringSchema(),
      missedCount: nonnegativeIntegerSchema(),
      monthCompleted: nonnegativeIntegerSchema(),
      monthScheduled: nonnegativeIntegerSchema(),
      scheduledCount: nonnegativeIntegerSchema(),
      skippedCount: nonnegativeIntegerSchema(),
      weekCompleted: nonnegativeIntegerSchema(),
      weekScheduled: nonnegativeIntegerSchema(),
    }),
    HabitStatsResponse: objectSchema({
      from: stringSchema(),
      habits: arrayOfRef('HabitRecord'),
      stats: arrayOfRef('HabitStats'),
      to: stringSchema(),
    }),
    HabitTodayItem: objectSchema({
      entry: nullableRef('HabitEntryRecord'),
      habit: ref('HabitRecord'),
      isDueToday: booleanSchema(),
      progressPercent: integerRangeSchema(0, 100),
      stats: ref('HabitStats'),
    }),
    HabitTodayResponse: objectSchema({
      date: stringSchema(),
      items: arrayOfRef('HabitTodayItem'),
    }),
    HabitUpdateInput: objectSchema(
      {
        color: {
          minLength: 1,
          type: 'string',
        },
        daysOfWeek: weekdayArraySchema({ requiresSchedule: true }),
        description: {
          maxLength: 600,
          type: 'string',
        },
        endDate: nullableStringSchema(),
        expectedVersion: positiveIntegerSchema(),
        frequency: enumSchema(habitFrequencySchema.options),
        icon: {
          minLength: 1,
          type: 'string',
        },
        isActive: booleanSchema(),
        reminderTime: nullableTimeStringSchema(),
        sortOrder: integerSchema(),
        sphereId: nullableStringSchema(),
        startDate: stringSchema(),
        targetType: enumSchema(habitTargetTypeSchema.options),
        targetValue: positiveIntegerSchema(),
        title: {
          maxLength: 120,
          minLength: 1,
          type: 'string',
        },
        unit: {
          maxLength: 24,
          type: 'string',
        },
      },
      [],
    ),
    NewHabitInput: objectSchema(
      {
        color: {
          default: '#2f6f62',
          minLength: 1,
          type: 'string',
        },
        daysOfWeek: weekdayArraySchema({ requiresSchedule: true }),
        description: {
          default: '',
          maxLength: 600,
          type: 'string',
        },
        endDate: {
          ...nullableStringSchema(),
          default: null,
        },
        frequency: {
          ...enumSchema(habitFrequencySchema.options),
          default: 'daily',
        },
        icon: {
          default: 'check',
          minLength: 1,
          type: 'string',
        },
        id: stringSchema(),
        reminderTime: {
          ...nullableTimeStringSchema(),
          default: null,
        },
        sortOrder: integerSchema(),
        sphereId: {
          ...nullableStringSchema(),
          default: null,
        },
        startDate: stringSchema(),
        targetType: {
          ...enumSchema(habitTargetTypeSchema.options),
          default: 'check',
        },
        targetValue: {
          ...positiveIntegerSchema(),
          default: 1,
        },
        title: {
          maxLength: 120,
          minLength: 1,
          type: 'string',
        },
        unit: {
          default: '',
          maxLength: 24,
          type: 'string',
        },
      },
      ['title'],
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

function nullableRef(schemaName: string): OpenAPIV3.SchemaObject {
  return {
    allOf: [ref(schemaName)],
    nullable: true,
  }
}

function nullableTimeStringSchema(): OpenAPIV3.SchemaObject {
  return {
    nullable: true,
    pattern: '^\\d{2}:\\d{2}$',
    type: 'string',
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

function weekdayArraySchema(
  options: { requiresSchedule?: boolean } = {},
): OpenAPIV3.SchemaObject {
  return {
    items: integerRangeSchema(1, 7),
    ...(options.requiresSchedule
      ? {
          maxItems: 7,
          minItems: 1,
        }
      : {}),
    type: 'array',
  }
}
