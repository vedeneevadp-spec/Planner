import {
  CalendarIcon,
  CheckIcon,
  HomeIcon,
  SettingsIcon,
  ShoppingBagIcon,
  SpheresIcon,
} from '@/shared/ui/Icon'

export function WorkspaceGearIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.2 4.6H13.8L14.25 6.55C14.73 6.73 15.18 6.98 15.58 7.29L17.46 6.68L19.25 9.82L17.82 11.15C17.86 11.43 17.88 11.71 17.88 12C17.88 12.29 17.86 12.57 17.82 12.85L19.25 14.18L17.46 17.32L15.58 16.71C15.18 17.02 14.73 17.27 14.25 17.45L13.8 19.4H10.2L9.75 17.45C9.27 17.27 8.82 17.02 8.42 16.71L6.54 17.32L4.75 14.18L6.18 12.85C6.14 12.57 6.12 12.29 6.12 12C6.12 11.71 6.14 11.43 6.18 11.15L4.75 9.82L6.54 6.68L8.42 7.29C8.82 6.98 9.27 6.73 9.75 6.55L10.2 4.6Z" />
      <circle cx="12" cy="12" r="2.45" />
    </svg>
  )
}

export function MoreIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle cx="6" cy="12" r="1.8" fill="currentColor" />
      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      <circle cx="18" cy="12" r="1.8" fill="currentColor" />
    </svg>
  )
}

export function SidebarNavIcon({ route }: { route: string }) {
  if (route === '/today') {
    return <CheckIcon size={20} strokeWidth={1.9} />
  }

  if (route === '/calendar') {
    return <CalendarIcon size={20} strokeWidth={1.9} />
  }

  if (route === '/shopping') {
    return <ShoppingBagIcon size={20} strokeWidth={1.9} />
  }

  if (route === '/cleaning') {
    return <HomeIcon size={20} strokeWidth={1.9} />
  }

  if (route === '/habits') {
    return <CheckIcon size={20} strokeWidth={1.9} />
  }

  if (route === '/spheres') {
    return <SpheresIcon size={20} strokeWidth={1.9} />
  }

  if (route === '/admin') {
    return <SettingsIcon size={20} strokeWidth={1.9} />
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
