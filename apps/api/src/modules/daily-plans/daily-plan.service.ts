import { HttpError } from '../../bootstrap/http-error.js'
import type {
  AutoBuildDailyPlanCommand,
  DailyPlanReadContext,
  DailyPlanWriteContext,
  UpsertDailyPlanCommand,
} from './daily-plan.model.js'
import type { DailyPlanRepository } from './daily-plan.repository.js'

export class DailyPlanService {
  constructor(private readonly repository: DailyPlanRepository) {}

  getPlan(context: DailyPlanReadContext, date: string) {
    return this.repository.getByDate({ context, date })
  }

  savePlan(
    context: DailyPlanWriteContext,
    date: string,
    input: UpsertDailyPlanCommand['input'],
  ) {
    assertCanWriteDailyPlan(context)

    return this.repository.upsert({ context, date, input })
  }

  autoBuild(
    context: DailyPlanWriteContext,
    input: AutoBuildDailyPlanCommand['input'],
  ) {
    assertCanWriteDailyPlan(context)

    return this.repository.autoBuild({ context, input })
  }

  unload(context: DailyPlanReadContext, date: string) {
    return this.repository.unload({ context, date })
  }
}

function assertCanWriteDailyPlan(context: DailyPlanWriteContext): void {
  if (context.role === 'guest') {
    throw new HttpError(
      403,
      'workspace_write_forbidden',
      'The current workspace role cannot write daily plans.',
    )
  }
}
