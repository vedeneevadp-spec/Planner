import { HttpError } from '../../bootstrap/http-error.js'
import { canWriteWorkspaceContent } from '../../shared/workspace-access.js'
import type {
  SelfCareReadContext,
  SelfCareWriteContext,
} from './self-care.model.js'
import type { SelfCareRepository } from './self-care.repository.js'

export class SelfCareService {
  constructor(private readonly repository: SelfCareRepository) {}

  listItems(
    context: SelfCareReadContext,
    filters?: Parameters<SelfCareRepository['listItems']>[1],
  ) {
    assertCanReadSelfCare(context)
    return this.repository.listItems(context, filters)
  }

  getDashboard(context: SelfCareReadContext, date: string) {
    assertCanReadSelfCare(context)
    return this.repository.getDashboard({ context, date })
  }

  getPlan(context: SelfCareReadContext, from: string, to: string) {
    assertCanReadSelfCare(context)
    return this.repository.getPlan({ context, from, to })
  }

  getOccurrences(context: SelfCareReadContext, from: string, to: string) {
    assertCanReadSelfCare(context)
    return this.repository.getOccurrences({ context, from, to })
  }

  getHistory(context: SelfCareReadContext, from: string, to: string) {
    assertCanReadSelfCare(context)
    return this.repository.getHistory(context, from, to)
  }

  getAnalytics(context: SelfCareReadContext, from: string, to: string) {
    assertCanReadSelfCare(context)
    return this.repository.getAnalytics(context, from, to)
  }

  getDailyState(context: SelfCareReadContext, date: string) {
    assertCanReadSelfCare(context)
    return this.repository.getDailyState(context, date)
  }

  getSettings(context: SelfCareReadContext) {
    assertCanReadSelfCare(context)
    return this.repository.getSettings(context)
  }

  listTemplates(context: SelfCareReadContext) {
    assertCanReadSelfCare(context)
    return this.repository.listTemplates(context)
  }

  createItem(
    context: SelfCareWriteContext,
    input: Parameters<SelfCareRepository['createItem']>[0]['input'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.createItem({ context, input })
  }

  updateItem(
    context: SelfCareWriteContext,
    itemId: string,
    input: Parameters<SelfCareRepository['updateItem']>[0]['input'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.updateItem({ context, input, itemId })
  }

  archiveItem(context: SelfCareWriteContext, itemId: string) {
    assertCanWriteSelfCare(context)
    return this.repository.archiveItem({ context, itemId })
  }

  restoreItem(context: SelfCareWriteContext, itemId: string) {
    assertCanWriteSelfCare(context)
    return this.repository.restoreItem({ context, itemId })
  }

  deleteItem(context: SelfCareWriteContext, itemId: string) {
    assertCanWriteSelfCare(context)
    return this.repository.deleteItem({ context, itemId })
  }

  generateOccurrences(context: SelfCareWriteContext, from: string, to: string) {
    assertCanWriteSelfCare(context)
    return this.repository.generateOccurrences({ context, from, to })
  }

  scheduleItem(
    context: SelfCareWriteContext,
    itemId: string,
    input: Parameters<SelfCareRepository['scheduleItem']>[0]['input'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.scheduleItem({ context, input, itemId })
  }

  completeOccurrence(
    context: SelfCareWriteContext,
    occurrenceId: string,
    input: Parameters<SelfCareRepository['completeOccurrence']>[0]['input'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.completeOccurrence({ context, input, occurrenceId })
  }

  completeItemNow(
    context: SelfCareWriteContext,
    itemId: string,
    input: Parameters<SelfCareRepository['completeItemNow']>[0]['input'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.completeItemNow({ context, input, itemId })
  }

  completeFlexibleGoal(
    context: SelfCareWriteContext,
    itemId: string,
    input: Parameters<SelfCareRepository['completeFlexibleGoal']>[0]['input'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.completeFlexibleGoal({ context, input, itemId })
  }

  completeCourseSession(
    context: SelfCareWriteContext,
    itemId: string,
    input: Parameters<SelfCareRepository['completeCourseSession']>[0]['input'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.completeCourseSession({ context, input, itemId })
  }

  skipOccurrence(
    context: SelfCareWriteContext,
    occurrenceId: string,
    input: Parameters<SelfCareRepository['skipOccurrence']>[0]['input'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.skipOccurrence({ context, input, occurrenceId })
  }

  moveOccurrence(
    context: SelfCareWriteContext,
    occurrenceId: string,
    input: Parameters<SelfCareRepository['moveOccurrence']>[0]['input'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.moveOccurrence({ context, input, occurrenceId })
  }

  cancelOccurrence(context: SelfCareWriteContext, occurrenceId: string) {
    assertCanWriteSelfCare(context)
    return this.repository.cancelOccurrence({ context, occurrenceId })
  }

  updateRitualSteps(
    context: SelfCareWriteContext,
    itemId: string,
    steps: Parameters<SelfCareRepository['updateRitualSteps']>[0]['steps'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.updateRitualSteps({ context, itemId, steps })
  }

  upsertDailyState(
    context: SelfCareWriteContext,
    date: string,
    input: Parameters<SelfCareRepository['upsertDailyState']>[0]['input'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.upsertDailyState({ context, date, input })
  }

  updateSettings(
    context: SelfCareWriteContext,
    input: Parameters<SelfCareRepository['updateSettings']>[0]['input'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.updateSettings({ context, input })
  }

  enableGentleMode(context: SelfCareWriteContext, date: string) {
    assertCanWriteSelfCare(context)
    return this.repository.enableGentleMode({ context, date })
  }

  disableGentleMode(context: SelfCareWriteContext, date: string) {
    assertCanWriteSelfCare(context)
    return this.repository.disableGentleMode({ context, date })
  }

  updateMinimumItems(
    context: SelfCareWriteContext,
    input: Parameters<SelfCareRepository['updateMinimumItems']>[0]['input'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.updateMinimumItems({ context, input })
  }

  createItemFromTemplate(
    context: SelfCareWriteContext,
    templateId: string,
    input: Parameters<SelfCareRepository['createItemFromTemplate']>[0]['input'],
  ) {
    assertCanWriteSelfCare(context)
    return this.repository.createItemFromTemplate({
      context,
      input,
      templateId,
    })
  }
}

function assertCanReadSelfCare(context: SelfCareReadContext): void {
  if (context.workspaceKind === 'shared') {
    throw new HttpError(
      403,
      'self_care_private_workspace',
      'Self-care is private and is available only in a personal workspace.',
    )
  }
}

function assertCanWriteSelfCare(context: SelfCareWriteContext): void {
  assertCanReadSelfCare(context)

  if (!canWriteWorkspaceContent(context)) {
    throw new HttpError(
      403,
      'workspace_write_forbidden',
      'The current workspace access cannot write self-care data.',
    )
  }
}
