import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import {
  addDateDays,
  getDateKeyInTimeZone,
  getTimeInTimeZone,
  selfCareItemInputSchema,
  selfCareItemScheduleInputSchema,
  selfCareItemUpdateInputSchema,
} from '@planner/contracts'
import { sql, type Transaction } from 'kysely'

import {
  createDatabaseConnection,
  destroyDatabaseConnection,
} from '../../infrastructure/db/client.js'
import { createDatabaseConfig } from '../../infrastructure/db/config.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import {
  cleanupRepositoryContractUsers,
  createRepositoryContractAuthContext,
  seedRepositoryContractWorkspace,
} from '../../testing/repository-contract-fixtures.js'
import type { SelfCareWriteContext } from '../self-care/self-care.model.js'
import { PostgresSelfCareRepository } from '../self-care/self-care.repository.postgres.js'
import type { DueSelfCareReminder } from './self-care-reminders.model.js'
import { PostgresSelfCareReminderOccurrenceGenerator } from './self-care-reminders.occurrence-generator.js'
import { PostgresSelfCareReminderRepository } from './self-care-reminders.repository.postgres.js'

async function withFixture(
  verify: (input: {
    context: SelfCareWriteContext
    repository: PostgresSelfCareRepository
    trx: Transaction<DatabaseSchema>
  }) => Promise<void>,
) {
  const connection = createDatabaseConnection(createDatabaseConfig())
  const userId = randomUUID()
  const rollback = new Error('Rollback isolated reminder fixture')
  try {
    const workspace = await seedRepositoryContractWorkspace(connection, {
      userId,
      kind: 'personal',
    })
    try {
      // Keep rules invisible to other concurrently running reminder workers.
      // The maintenance repository intentionally has no user-scoped RLS context.
      await connection.db.transaction().execute(async (trx) => {
        await verify({
          context: {
            actorUserId: userId,
            auth: createRepositoryContractAuthContext({
              userId,
              email: workspace.email,
            }),
            clientTimeZone: 'UTC',
            role: 'owner',
            workspaceId: workspace.workspaceId,
            workspaceKind: 'personal',
          },
          repository: new PostgresSelfCareRepository(trx),
          trx,
        })
        throw rollback
      })
    } catch (error) {
      if (error !== rollback) throw error
    }
  } finally {
    await cleanupRepositoryContractUsers(connection, [userId])
    await destroyDatabaseConnection(connection)
  }
}

void test('self-care pause suppresses reminders until the recurring item is resumed', async () => {
  await withFixture(async ({ context, repository, trx }) => {
    const due = new Date(Date.now() + 2 * 60_000)
    const item = await repository.createItem({
      context,
      input: selfCareItemInputSchema.parse({
        category: 'movement',
        title: 'Pause reminders',
        type: 'habit',
        scheduleRule: {
          repeatKind: 'daily',
          startDate: getDateKeyInTimeZone(due, 'UTC'),
          preferredTime: getTimeInTimeZone(due, 'UTC'),
          timezone: 'UTC',
          reminderOffsetsMinutes: [15],
        },
      }),
    })
    const reminders = new PostgresSelfCareReminderRepository(trx)
    const claimed = (await reminders.claimDueReminders(250)).filter(
      (entry) => entry.itemId === item.id,
    )
    assert.equal(claimed.length, 1)
    await repository.updateItem({
      context,
      itemId: item.id,
      input: selfCareItemUpdateInputSchema.parse({ isActive: false }),
    })
    assert.equal(
      (await reminders.claimDueReminders(250)).some(
        (entry) => entry.itemId === item.id,
      ),
      false,
    )
    await repository.updateItem({
      context,
      itemId: item.id,
      input: selfCareItemUpdateInputSchema.parse({ isActive: true }),
    })
    // The page refresh materializes the resumed date. This fixture uses one
    // transaction, so PostgreSQL now() cannot advance item.updated_at between actions.
    await repository.getDashboard({
      context,
      date: getDateKeyInTimeZone(due, 'UTC'),
    })
    assert.equal(
      (await reminders.claimDueReminders(250)).filter(
        (entry) => entry.itemId === item.id,
      ).length,
      1,
    )
  })
})

void test('self-care workers cannot reclaim an unchanged reminder while delivery is in flight', async () => {
  await withClaimedReminder(async ({ reminder, reminders, trx }) => {
    const secondWorker = new PostgresSelfCareReminderRepository(trx)
    // The first worker is sending its push while the second materializes the same reminder.
    const second = (await secondWorker.claimDueReminders(250)).filter(
      (entry) => entry.id === reminder.id,
    )
    assert.equal(second.length, 0)
    const row = await trx
      .selectFrom('app.self_care_reminders')
      .select(sql<string>`claimed_at::text`.as('claimedAt'))
      .where('id', '=', reminder.id)
      .executeTakeFirstOrThrow()
    assert.equal(reminder.claimedAt, row.claimedAt)
    assert.equal(await reminders.markDelivered(reminder), true)
    assert.equal(await reminders.markDelivered(reminder), false)
  })
})

void test('self-care reminder acknowledgements cannot overwrite a replacement claim', async () => {
  await withClaimedReminder(async ({ reminder, reminders, trx }) => {
    await trx
      .updateTable('app.self_care_reminders')
      .set({ claimed_at: sql`now() - interval '6 minutes'` })
      .where('id', '=', reminder.id)
      .execute()
    const replacement = (await reminders.claimDueReminders(250)).find(
      (entry) => entry.id === reminder.id,
    )
    assert.ok(replacement)
    assert.notEqual(replacement.claimedAt, reminder.claimedAt)
    const read = () =>
      trx
        .selectFrom('app.self_care_reminders')
        .selectAll()
        .where('id', '=', reminder.id)
        .executeTakeFirstOrThrow()
    const before = await read()

    assert.equal(await reminders.markDelivered(reminder), false)
    assert.equal(
      await reminders.markUndeliverable(reminder, 'old outcome'),
      false,
    )
    assert.equal(await reminders.releaseClaim(reminder, 'old failure'), false)
    assert.deepEqual(await read(), before)
    assert.equal(await reminders.markDelivered(replacement), true)
  })
})

void test('rescheduling a self-care reminder invalidates the previous delivery claim', async () => {
  await withClaimedReminder(async ({ reminder, reminders, trx }) => {
    await trx
      .updateTable('app.self_care_occurrences')
      .set({ due_at: sql`due_at + interval '1 minute'` })
      .where('id', '=', reminder.occurrenceId)
      .execute()
    const replacement = (await reminders.claimDueReminders(250)).find(
      (entry) => entry.id === reminder.id,
    )
    assert.ok(replacement)
    assert.notEqual(replacement.claimedAt, reminder.claimedAt)
    assert.equal(await reminders.markDelivered(reminder), false)
    assert.equal(
      await reminders.markUndeliverable(reminder, 'old recipient'),
      false,
    )
    assert.equal(await reminders.releaseClaim(reminder, 'old retry'), false)
    assert.equal(await reminders.markDelivered(replacement), true)
  })
})

void test('canceling a self-care item invalidates its in-flight reminder claim', async () => {
  await withClaimedReminder(async ({ reminder, reminders, trx }) => {
    await trx
      .updateTable('app.self_care_items')
      .set({ is_active: false })
      .where('id', '=', reminder.itemId)
      .execute()
    assert.equal(
      (await reminders.claimDueReminders(250)).some(
        (entry) => entry.id === reminder.id,
      ),
      false,
    )
    assert.equal(await reminders.markDelivered(reminder), false)
    assert.equal(await reminders.markUndeliverable(reminder, 'canceled'), false)
    assert.equal(await reminders.releaseClaim(reminder, 'canceled'), false)
    const row = await trx
      .selectFrom('app.self_care_reminders')
      .selectAll()
      .where('id', '=', reminder.id)
      .executeTakeFirstOrThrow()
    assert.ok(row.canceled_at)
    assert.equal(row.sent_at, null)
    assert.equal(row.attempt_count, 0)
  })
})

void test('self-care retries require a fresh claim and stop after the attempt limit', async () => {
  await withClaimedReminder(async ({ reminder, reminders, trx }) => {
    let current = reminder
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      assert.equal(
        await reminders.releaseClaim(current, `attempt ${attempt}`),
        true,
      )
      assert.equal(
        await reminders.releaseClaim(current, 'duplicate outcome'),
        false,
      )
      const next = (await reminders.claimDueReminders(250)).find(
        (entry) => entry.id === reminder.id,
      )
      if (attempt < 8) {
        assert.ok(next)
        assert.notEqual(next.claimedAt, current.claimedAt)
        current = next
      } else {
        assert.equal(next, undefined)
      }
    }
    const row = await trx
      .selectFrom('app.self_care_reminders')
      .selectAll()
      .where('id', '=', reminder.id)
      .executeTakeFirstOrThrow()
    assert.equal(row.attempt_count, 8)
    assert.equal(row.last_error, 'attempt 8')
    assert.ok(row.failed_at)
    assert.equal(row.sent_at, null)
  })
})

void test('an owned undeliverable self-care reminder stays terminal on the next poll', async () => {
  await withClaimedReminder(async ({ reminder, reminders, trx }) => {
    assert.equal(
      await reminders.markUndeliverable(reminder, 'no_recipient'),
      true,
    )
    assert.equal(
      await reminders.markUndeliverable(reminder, 'duplicate'),
      false,
    )
    assert.equal(
      (await reminders.claimDueReminders(250)).some(
        (entry) => entry.id === reminder.id,
      ),
      false,
    )
    const row = await trx
      .selectFrom('app.self_care_reminders')
      .selectAll()
      .where('id', '=', reminder.id)
      .executeTakeFirstOrThrow()
    assert.equal(row.attempt_count, 1)
    assert.equal(row.last_error, 'no_recipient')
    assert.ok(row.failed_at)
    assert.equal(row.sent_at, null)
  })
})

async function withClaimedReminder(
  verify: (input: {
    reminder: DueSelfCareReminder
    reminders: PostgresSelfCareReminderRepository
    trx: Transaction<DatabaseSchema>
  }) => Promise<void>,
) {
  await withFixture(async ({ context, repository, trx }) => {
    const due = new Date(Date.now() + 2 * 60_000)
    const item = await repository.createItem({
      context,
      input: selfCareItemInputSchema.parse({
        category: 'movement',
        title: 'Concurrent reminder delivery',
        type: 'habit',
        scheduleRule: {
          repeatKind: 'daily',
          startDate: getDateKeyInTimeZone(due, 'UTC'),
          preferredTime: getTimeInTimeZone(due, 'UTC'),
          timezone: 'UTC',
          reminderOffsetsMinutes: [15],
        },
      }),
    })
    const reminders = new PostgresSelfCareReminderRepository(trx)
    const claimed = (await reminders.claimDueReminders(250)).filter(
      (entry) => entry.itemId === item.id,
    )
    assert.equal(claimed.length, 1)
    const reminder = claimed[0]!
    assert.equal(typeof reminder.claimedAt, 'string')
    await verify({ reminder, reminders, trx })
  })
}

void test('self-care worker claims a recurring reminder without any interactive read', async () => {
  await withFixture(async ({ context, repository, trx }) => {
    const due = new Date(Date.now() + 2 * 60_000)
    const item = await repository.createItem({
      context,
      input: selfCareItemInputSchema.parse({
        category: 'movement',
        title: 'Unopened recurring habit',
        type: 'habit',
        scheduleRule: {
          repeatKind: 'daily',
          startDate: getDateKeyInTimeZone(due, 'UTC'),
          preferredTime: getTimeInTimeZone(due, 'UTC'),
          timezone: 'UTC',
          reminderOffsetsMinutes: [15],
        },
      }),
    })
    const occurrences = () =>
      trx
        .selectFrom('app.self_care_occurrences')
        .selectAll()
        .where('item_id', '=', item.id)
        .execute()
    assert.equal((await occurrences()).length, 0)

    const reminders = new PostgresSelfCareReminderRepository(trx)
    const claimed = (await reminders.claimDueReminders(250)).filter(
      (entry) => entry.itemId === item.id,
    )
    assert.equal(claimed.length, 1)
    assert.equal(claimed[0]!.scheduledFor, getDateKeyInTimeZone(due, 'UTC'))
    assert.ok((await occurrences()).length >= 31)
    assert.equal(await reminders.markDelivered(claimed[0]!), true)
    assert.equal(
      (await reminders.claimDueReminders(250)).filter(
        (entry) => entry.itemId === item.id,
      ).length,
      0,
    )
  })
})

void test('background generation covers the maximum reminder offset, DST, and later restarts', async () => {
  await withFixture(async ({ context, repository, trx }) => {
    let now = new Date('2027-03-27T11:00:00.000Z')
    const item = await repository.createItem({
      context,
      input: selfCareItemInputSchema.parse({
        category: 'movement',
        title: 'DST habit',
        type: 'habit',
        scheduleRule: {
          repeatKind: 'daily',
          startDate: '2027-03-01',
          preferredTime: '02:30',
          timezone: 'Europe/Amsterdam',
          reminderOffsetsMinutes: [43200],
        },
      }),
    })
    const occurrences = () =>
      trx
        .selectFrom('app.self_care_occurrences')
        .selectAll()
        .where('item_id', '=', item.id)
        .orderBy('scheduled_for')
        .execute()
    const generate = () =>
      new PostgresSelfCareReminderOccurrenceGenerator(
        trx,
        () => now,
      ).materializeUpcomingOccurrences()
    await generate()
    const initial = await occurrences()
    assert.equal(initial.length, 32)
    assert.equal(initial[0]!.scheduled_for, '2027-03-27')
    assert.equal(initial.at(-1)!.scheduled_for, '2027-04-27')
    const dst = initial.find((entry) => entry.scheduled_for === '2027-03-28')!
    assert.equal(
      new Date(dst.due_at!).toISOString(),
      '2027-03-28T01:00:00.000Z',
    )
    const maxOffset = initial.find(
      (entry) => entry.scheduled_for === '2027-04-26',
    )!
    assert.ok(
      new Date(maxOffset.due_at!).getTime() - 43200 * 60_000 <= now.getTime(),
    )
    await generate()
    assert.deepEqual(await occurrences(), initial)

    now = new Date('2027-04-28T11:00:00.000Z')
    await generate()
    const afterRestart = await occurrences()
    assert.equal(afterRestart.at(-1)!.scheduled_for, '2027-05-29')
    assert.deepEqual(afterRestart.slice(0, initial.length), initial)
  })
})

void test('background generation respects course pauses and explicit manual schedule exceptions', async () => {
  await withFixture(async ({ context, repository, trx }) => {
    const now = new Date()
    const today = getDateKeyInTimeZone(now, 'UTC')
    const scheduleRule = {
      repeatKind: 'daily',
      startDate: today,
      preferredTime: '09:00',
      timezone: 'UTC',
      reminderOffsetsMinutes: [15],
    }
    const habit = await repository.createItem({
      context,
      input: selfCareItemInputSchema.parse({
        category: 'movement',
        title: 'Manual exception',
        type: 'habit',
        scheduleRule,
      }),
    })
    const manualDate = addDateDays(today, 1)
    const manual = await repository.scheduleItem({
      context,
      itemId: habit.id,
      input: selfCareItemScheduleInputSchema.parse({
        scheduledFor: manualDate,
        scheduledTime: '17:00',
        timezone: 'UTC',
      }),
    })
    const paused = await repository.createItem({
      context,
      input: selfCareItemInputSchema.parse({
        category: 'movement',
        title: 'Paused course',
        type: 'course',
        scheduleRule: {
          ...scheduleRule,
          repeatKind: 'course',
          intervalValue: 1,
          intervalUnit: 'day',
        },
        courseDetails: {
          courseType: 'days',
          totalCount: 14,
          isPaused: true,
          startDate: today,
        },
      }),
    })
    await new PostgresSelfCareReminderOccurrenceGenerator(
      trx,
    ).materializeUpcomingOccurrences()
    const occurrences = await trx
      .selectFrom('app.self_care_occurrences')
      .selectAll()
      .where('item_id', 'in', [habit.id, paused.id])
      .execute()
    assert.equal(
      occurrences.filter((entry) => entry.item_id === paused.id).length,
      0,
    )
    const manualSlots = occurrences.filter(
      (entry) =>
        entry.item_id === habit.id && entry.scheduled_for === manualDate,
    )
    assert.equal(manualSlots.length, 1)
    assert.equal(manualSlots[0]!.id, manual.id)
    assert.equal(
      new Date(manualSlots[0]!.due_at!).toISOString(),
      `${manualDate}T17:00:00.000Z`,
    )
    assert.equal(manualSlots[0]!.generated_at, null)
  })
})

void test('background generation drains multiple batches and isolates a malformed persisted rule', async (t) => {
  const errors = t.mock.method(console, 'error', () => {})
  await withFixture(async ({ context, repository, trx }) => {
    const now = new Date()
    const today = getDateKeyInTimeZone(now, 'UTC')
    const create = (title: string, preferredTime: string, startDate = today) =>
      repository.createItem({
        context,
        input: selfCareItemInputSchema.parse({
          category: 'movement',
          title,
          type: 'habit',
          scheduleRule: {
            repeatKind: 'daily',
            startDate,
            preferredTime,
            timezone: 'UTC',
            reminderOffsetsMinutes: [15],
          },
        }),
      })
    // PostgreSQL accepts 24:00, and older API validation accepts it as well.
    const invalid = await create('Malformed legacy time', '24:00')
    const first = await create('First batch', '09:00')
    const second = await create('Later batch', '10:00')
    const distant = await create(
      'Not due to materialize',
      '09:00',
      addDateDays(today, 100),
    )
    await new PostgresSelfCareReminderOccurrenceGenerator(
      trx,
    ).materializeUpcomingOccurrences(1)
    const occurrences = await trx
      .selectFrom('app.self_care_occurrences')
      .selectAll()
      .where('item_id', 'in', [invalid.id, first.id, second.id, distant.id])
      .execute()
    assert.ok(occurrences.some((entry) => entry.item_id === first.id))
    assert.ok(occurrences.some((entry) => entry.item_id === second.id))
    assert.equal(
      occurrences.some((entry) => entry.item_id === invalid.id),
      false,
    )
    assert.equal(
      occurrences.some((entry) => entry.item_id === distant.id),
      false,
    )
    assert.ok(
      errors.mock.calls.some(
        (call) =>
          (call.arguments[1] as { itemId?: string } | undefined)?.itemId ===
          invalid.id,
      ),
    )
    const checkpoints = await trx
      .selectFrom('app.self_care_reminder_generation as generation')
      .innerJoin(
        'app.self_care_schedule_rules as rule',
        'rule.id',
        'generation.schedule_rule_id',
      )
      .select('rule.item_id')
      .where('rule.item_id', 'in', [
        invalid.id,
        first.id,
        second.id,
        distant.id,
      ])
      .execute()
    assert.deepEqual(
      checkpoints.map((entry) => entry.item_id).sort(),
      [invalid.id, first.id, second.id].sort(),
    )
  })
})
