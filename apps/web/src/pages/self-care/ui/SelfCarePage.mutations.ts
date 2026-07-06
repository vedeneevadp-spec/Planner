import {
  useArchiveSelfCareItem,
  useCancelSelfCareOccurrence,
  useCompleteSelfCareCourseSession,
  useCompleteSelfCareFlexibleGoal,
  useCompleteSelfCareItemNow,
  useCompleteSelfCareOccurrence,
  useCreateSelfCareItem,
  useCreateSelfCareItemFromTemplate,
  useMoveSelfCareOccurrence,
  useScheduleSelfCareItem,
  useSkipSelfCareOccurrence,
  useUpdateSelfCareCompletion,
  useUpdateSelfCareItem,
  useUpdateSelfCareSettings,
  useUpsertSelfCareRitualStepDraft,
} from '@/features/self-care'

export function useSelfCarePageMutations() {
  const completeOccurrenceMutation = useCompleteSelfCareOccurrence()
  const completeItemNowMutation = useCompleteSelfCareItemNow()
  const completeFlexibleGoalMutation = useCompleteSelfCareFlexibleGoal()
  const completeCourseMutation = useCompleteSelfCareCourseSession()
  const cancelOccurrenceMutation = useCancelSelfCareOccurrence()
  const skipOccurrenceMutation = useSkipSelfCareOccurrence()
  const archiveItemMutation = useArchiveSelfCareItem()
  const scheduleItemMutation = useScheduleSelfCareItem()
  const moveOccurrenceMutation = useMoveSelfCareOccurrence()
  const createItemMutation = useCreateSelfCareItem()
  const createFromTemplateMutation = useCreateSelfCareItemFromTemplate()
  const updateItemMutation = useUpdateSelfCareItem()
  const updateCompletionMutation = useUpdateSelfCareCompletion()
  const updateSettingsMutation = useUpdateSelfCareSettings()
  const upsertRitualStepDraftMutation = useUpsertSelfCareRitualStepDraft()
  const isActionBusy =
    completeOccurrenceMutation.isPending ||
    completeItemNowMutation.isPending ||
    completeFlexibleGoalMutation.isPending ||
    completeCourseMutation.isPending ||
    cancelOccurrenceMutation.isPending ||
    skipOccurrenceMutation.isPending ||
    archiveItemMutation.isPending ||
    scheduleItemMutation.isPending ||
    moveOccurrenceMutation.isPending ||
    createItemMutation.isPending ||
    createFromTemplateMutation.isPending ||
    updateItemMutation.isPending ||
    updateCompletionMutation.isPending ||
    updateSettingsMutation.isPending
  const mutationErrors = [
    completeOccurrenceMutation.error,
    completeItemNowMutation.error,
    completeFlexibleGoalMutation.error,
    completeCourseMutation.error,
    cancelOccurrenceMutation.error,
    skipOccurrenceMutation.error,
    archiveItemMutation.error,
    scheduleItemMutation.error,
    moveOccurrenceMutation.error,
    createItemMutation.error,
    createFromTemplateMutation.error,
    updateItemMutation.error,
    updateCompletionMutation.error,
    updateSettingsMutation.error,
    upsertRitualStepDraftMutation.error,
  ] as const

  return {
    archiveItemMutation,
    cancelOccurrenceMutation,
    completeCourseMutation,
    completeFlexibleGoalMutation,
    completeItemNowMutation,
    completeOccurrenceMutation,
    createFromTemplateMutation,
    createItemMutation,
    isActionBusy,
    moveOccurrenceMutation,
    mutationErrors,
    scheduleItemMutation,
    skipOccurrenceMutation,
    updateItemMutation,
    updateCompletionMutation,
    updateSettingsMutation,
    upsertRitualStepDraftMutation,
  }
}
