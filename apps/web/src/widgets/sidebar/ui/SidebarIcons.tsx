import {
  CalendarPageIcon,
  ChecklistIcon,
  CleaningZonesIcon,
  GearIcon,
  HabitsTargetIcon,
  MoreSlidersIcon,
  ShoppingCartIcon,
  SpheresChartIcon,
  TimelinePageIcon,
} from '@/shared/ui/Icon'

export function WorkspaceGearIcon() {
  return <GearIcon size={15} strokeWidth={1.85} />
}

export function MoreIcon() {
  return <MoreSlidersIcon size={20} />
}

export function SidebarNavIcon({ route }: { route: string }) {
  if (route === '/today') {
    return <ChecklistIcon size={20} />
  }

  if (route === '/calendar') {
    return <CalendarPageIcon size={20} />
  }

  if (route === '/shopping') {
    return <ShoppingCartIcon size={20} strokeWidth={1.9} />
  }

  if (route === '/cleaning') {
    return <CleaningZonesIcon size={20} />
  }

  if (route === '/habits') {
    return <HabitsTargetIcon size={20} />
  }

  if (route === '/spheres') {
    return <SpheresChartIcon size={20} />
  }

  if (route === '/admin') {
    return <GearIcon size={20} strokeWidth={1.9} />
  }

  if (route === '/timeline') {
    return <TimelinePageIcon size={20} />
  }

  return <TimelineIcon />
}

function TimelineIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7H20" />
      <path d="M4 17H20" />
      <circle cx="8" cy="7" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}
