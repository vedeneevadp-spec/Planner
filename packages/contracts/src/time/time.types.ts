export type IanaTimeZone = string

export type PlannerTimeKind =
  | 'instant'
  | 'date_only'
  | 'fixed_zone_datetime'
  | 'floating_local_time'

export type TimeZoneMode = 'device' | 'manual' | 'workspace'

export interface DateOnlyValue {
  kind: 'date_only'
  localDate: string
}

export interface FixedZoneDateTimeValue {
  kind: 'fixed_zone_datetime'
  localDate: string
  localTime: string
  timeZone: IanaTimeZone
  instantUtc: string
}

export interface FloatingLocalTimeValue {
  kind: 'floating_local_time'
  localTime: string
  recurrenceRule?: string
}

export interface InstantValue {
  instantUtc: string
  kind: 'instant'
}

export type PlannerScheduleValue =
  | DateOnlyValue
  | FixedZoneDateTimeValue
  | FloatingLocalTimeValue

export interface TimeService {
  getDeviceTimeZone(): IanaTimeZone | null
  getPlannerTimeZone(input: {
    deviceTimeZone?: IanaTimeZone | null
    timeZoneMode?: TimeZoneMode | null
    userTimeZone?: IanaTimeZone | null
    workspaceTimeZone?: IanaTimeZone | null
  }): IanaTimeZone
  getTodayDate(timeZone: IanaTimeZone): string
  getDayRangeUtc(input: { localDate: string; timeZone: IanaTimeZone }): {
    endUtc: string
    startUtc: string
  }
  makeFixedZoneDateTime(input: {
    localDate: string
    localTime: string
    timeZone: IanaTimeZone
  }): FixedZoneDateTimeValue
  formatForUser(input: {
    displayTimeZone: IanaTimeZone
    locale?: string
    value: DateOnlyValue | FixedZoneDateTimeValue | FloatingLocalTimeValue
  }): string
}

export interface DateParseContext {
  locale: 'ru-RU'
  plannerTimeZone: IanaTimeZone
  referenceInstantUtc: string
}
