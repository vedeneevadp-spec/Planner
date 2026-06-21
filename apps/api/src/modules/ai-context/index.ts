export { compactArrayForAi, compactForAi } from './ai-context.compact.js'
export {
  getScopesForInclude,
  getScopesForSearchTypes,
  HAOTIKA_MCP_READ_SCOPES,
  type HaotikaMcpScope,
  PLANNER_SEARCH_TYPES,
  type PlannerSearchType,
  TODAY_CONTEXT_INCLUDE_KEYS,
  type TodayContextInclude,
} from './ai-context.permissions.js'
export {
  AiContextService,
  type AiContextServiceDependencies,
  AiContextValidationError,
} from './ai-context.service.js'
export type {
  AiCalendarEvent,
  AiCleaningTask,
  AiHabitItem,
  AiLoadLevel,
  AiSelfCareItem,
  AiShoppingItem,
  AiSuggestedMode,
  AiTaskItem,
  GetOverloadContextParams,
  GetSelfCareContextParams,
  GetTodayContextParams,
  GetWeekContextParams,
  OverloadContext,
  PlannerSearchResult,
  SearchPlannerParams,
  SelfCareContext,
  TodayContext,
  WeekContext,
} from './ai-context.types.js'
