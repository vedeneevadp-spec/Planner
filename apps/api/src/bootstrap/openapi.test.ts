import assert from 'node:assert/strict'
import { test } from 'node:test'

import { taskSchema } from '@planner/contracts'
import type { OpenAPIV3 } from 'openapi-types'
import { z } from 'zod'

import { createComponentSchemas } from './openapi-components.js'
import { contractSchema } from './openapi-schema.js'

void test('documents normalized response fields without making request defaults required', () => {
  const schemas = createComponentSchemas()
  assert.deepEqual(schemas.PublicTaskCreate.required, ['title'])
  assert.deepEqual(schemas.PublicTaskUpdate.required, ['expectedVersion'])
  assert.equal(schemas.PublicTaskUpdate.minProperties, 2)
  for (const field of [
    'resource',
    'icon',
    'requiresConfirmation',
    'sphereId',
  ]) {
    assert.ok(schemas.TaskRecord.required?.includes(field))
  }
  const properties = schemas.TaskRecord.properties as Record<
    string,
    OpenAPIV3.SchemaObject
  >
  assert.ok(properties.resource)
  assert.ok(properties.requiresConfirmation)
  assert.ok(properties.reminderOffsets?.type === 'array')
  assert.equal(properties.resource.nullable, true)
  assert.equal(properties.resource.minimum, -5)
  assert.equal(properties.resource.maximum, 5)
  assert.equal(properties.requiresConfirmation.type, 'boolean')
  assert.deepEqual(
    taskSchema.shape.reminderOffsets.parse([60, 15, 60]),
    [15, 60],
  )
  assert.equal(properties.reminderOffsets.maxItems, 3)
})

void test('rejects undocumented output transforms instead of publishing an unconstrained schema', () => {
  assert.throws(
    () =>
      contractSchema(
        z.string().transform((value) => value.length),
        'output',
      ),
    /cannot be represented/,
  )
})

void test('keeps current fields and legacy compatibility values distinct', () => {
  const schemas = createComponentSchemas()
  assert.ok(schemas.NewTaskInput.properties?.necessity)
  assert.ok(schemas.NewTaskInput.properties?.recurrence)
  assert.ok(schemas.SelfCareItem.properties?.pausePeriods)
  assert.ok(schemas.SelfCareItemInput.properties?.exerciseDetails)
  assert.ok(schemas.SessionActor.properties?.avatarUrl)
  assert.ok(schemas.UserPreferences.properties?.defaultTimeZone)
  const retired = schemas.UserPreferences.properties
    ?.voiceAssistantEnabled as OpenAPIV3.SchemaObject
  assert.deepEqual(retired.enum, [false])
  const sphere = schemas.LifeSphereRecord
  assert.ok(sphere.properties?.id)
  assert.ok(sphere.properties?.name)
})
