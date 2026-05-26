import type { ReactNode, SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement> & {
  size?: number
  strokeWidth?: number
}

function SvgIcon({
  size = 24,
  strokeWidth = 2,
  children,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3 6H21" />
      <path d="M8 6V4.75C8 4.34 8.34 4 8.75 4H15.25C15.66 4 16 4.34 16 4.75V6" />
      <path d="M18 6L17.15 18.74C17.08 19.83 16.17 20.67 15.08 20.67H8.92C7.83 20.67 6.92 19.83 6.85 18.74L6 6" />
      <path d="M10 10V16" />
      <path d="M14 10V16" />
    </SvgIcon>
  )
}

export function EditIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12.5 6.5L17.5 11.5" />
      <path d="M5 19L8.5 18.5L18.2 8.8C19.27 7.73 19.27 6.02 18.2 4.95C17.13 3.88 15.42 3.88 14.35 4.95L4.65 14.65L4 18.99L5 19Z" />
      <path d="M4 20H20" />
    </SvgIcon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M18 6L6 18" />
      <path d="M6 6L18 18" />
    </SvgIcon>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5 12.5L9.5 17L19 7.5" />
    </SvgIcon>
  )
}

export function HabitsTargetIcon(props: IconProps) {
  return (
    <SvgIcon {...props} fill="currentColor" stroke="none">
      <path
        fillRule="nonzero"
        d="M14 8.586V6a1 1 0 0 1 .293-.707l3-3a1 1 0 0 1 1.601.26l.851 1.702l1.702.85a1 1 0 0 1 .26 1.602l-3 3A1 1 0 0 1 18 10h-2.586l-2.707 2.707a1 1 0 0 1-1.414-1.414L14 8.586zM12 3a1 1 0 0 1 0 2a7 7 0 1 0 7 7a1 1 0 0 1 2 0a9 9 0 1 1-9-9zm0 4a1 1 0 0 1 0 2a3 3 0 1 0 3 3a1 1 0 0 1 2 0a5 5 0 1 1-5-5zm4-.586V8h1.586l1.726-1.726l-.76-.38a1 1 0 0 1-.446-.447l-.38-.759L16 6.414z"
      />
    </SvgIcon>
  )
}

export function ChecklistIcon(props: IconProps) {
  return (
    <SvgIcon {...props} fill="currentColor" stroke="none">
      <path d="M2,11H8a1,1,0,0,0,1-1V4A1,1,0,0,0,8,3H2A1,1,0,0,0,1,4v6A1,1,0,0,0,2,11ZM3,5H7V9H3ZM23,7a1,1,0,0,1-1,1H12a1,1,0,0,1,0-2H22A1,1,0,0,1,23,7Zm0,10a1,1,0,0,1-1,1H12a1,1,0,0,1,0-2H22A1,1,0,0,1,23,17ZM3.235,19.7,1.281,17.673a1,1,0,0,1,1.438-1.391l1.252,1.3L7.3,14.289A1,1,0,1,1,8.7,15.711l-4.046,4a1,1,0,0,1-.7.289H3.942A1,1,0,0,1,3.235,19.7Z" />
    </SvgIcon>
  )
}

export function DogIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M8.25 8.25L6.45 5.95C5.84 5.17 4.62 5.43 4.36 6.38L3.75 8.75" />
      <path d="M15.75 8.25L17.55 5.95C18.16 5.17 19.38 5.43 19.64 6.38L20.25 8.75" />
      <path d="M7.75 8.25H16.25C17.91 8.25 19.25 9.59 19.25 11.25V13.25C19.25 17.26 16.01 20.5 12 20.5C7.99 20.5 4.75 17.26 4.75 13.25V11.25C4.75 9.59 6.09 8.25 7.75 8.25Z" />
      <path d="M9.5 12H9.51" />
      <path d="M14.5 12H14.51" />
      <path d="M10.25 15.25C10.82 15.82 11.33 16 12 16C12.67 16 13.18 15.82 13.75 15.25" />
      <path d="M12 12.75V13.9" />
    </SvgIcon>
  )
}

export function HomeIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M3.75 10.25L12 4L20.25 10.25" />
      <path d="M6.25 8.75V18.25C6.25 19.35 7.15 20.25 8.25 20.25H15.75C16.85 20.25 17.75 19.35 17.75 18.25V8.75" />
      <path d="M10 20.25V14.25C10 13.7 10.45 13.25 11 13.25H13C13.55 13.25 14 13.7 14 14.25V20.25" />
    </SvgIcon>
  )
}

export function CleaningZonesIcon({ strokeWidth = 1.5, ...props }: IconProps) {
  return (
    <SvgIcon {...props} strokeWidth={strokeWidth}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 20V4" />
      <path d="M20 10H12" />
      <path d="M12 14H4" />
    </SvgIcon>
  )
}

export function ChildrenIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="8" cy="6.75" r="1.75" />
      <circle cx="16" cy="6.75" r="1.75" />
      <path d="M8 8.5V13" />
      <path d="M16 8.5V13" />
      <path d="M5.75 11.25L8 9.75L10.25 11.25" />
      <path d="M13.75 11.25L16 9.75L18.25 11.25" />
      <path d="M6.5 14.25H9.5" />
      <path d="M14.5 14.25H17.5" />
      <path d="M7 20L8 15.5L9 20" />
      <path d="M15 20L16 15.5L17 20" />
    </SvgIcon>
  )
}

export function HeartIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 20.5L10.88 19.48C6.1 15.15 3 12.33 3 8.86C3 6.32 4.98 4.5 7.4 4.5C8.8 4.5 10.14 5.14 11.05 6.23L12 7.36L12.95 6.23C13.86 5.14 15.2 4.5 16.6 4.5C19.02 4.5 21 6.32 21 8.86C21 12.33 17.9 15.15 13.12 19.48L12 20.5Z" />
    </SvgIcon>
  )
}

export function CarIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M7.25 16.75H16.75C18.13 16.75 19.25 15.63 19.25 14.25V12.87C19.25 12.02 18.81 11.23 18.09 10.78L16.75 9.94L15.68 7.45C15.17 6.27 14.01 5.5 12.73 5.5H11.27C9.99 5.5 8.83 6.27 8.32 7.45L7.25 9.94L5.91 10.78C5.19 11.23 4.75 12.02 4.75 12.87V14.25C4.75 15.63 5.87 16.75 7.25 16.75Z" />
      <path d="M7.5 10.5H16.5" />
      <circle cx="8" cy="17.25" r="1.25" />
      <circle cx="16" cy="17.25" r="1.25" />
    </SvgIcon>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20L15.5 15.5" />
    </SvgIcon>
  )
}

export function GearIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M10.2 4.6H13.8L14.25 6.55C14.73 6.73 15.18 6.98 15.58 7.29L17.46 6.68L19.25 9.82L17.82 11.15C17.86 11.43 17.88 11.71 17.88 12C17.88 12.29 17.86 12.57 17.82 12.85L19.25 14.18L17.46 17.32L15.58 16.71C15.18 17.02 14.73 17.27 14.25 17.45L13.8 19.4H10.2L9.75 17.45C9.27 17.27 8.82 17.02 8.42 16.71L6.54 17.32L4.75 14.18L6.18 12.85C6.14 12.57 6.12 12.29 6.12 12C6.12 11.71 6.14 11.43 6.18 11.15L4.75 9.82L6.54 6.68L8.42 7.29C8.82 6.98 9.27 6.73 9.75 6.55L10.2 4.6Z" />
      <circle cx="12" cy="12" r="2.45" />
    </SvgIcon>
  )
}

export function UserIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="8" r="3" />
      <path d="M6 19C6.9 16.83 8.98 15.75 12 15.75C15.02 15.75 17.1 16.83 18 19" />
    </SvgIcon>
  )
}

export function BellIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M6.25 16.25H17.75L16.75 14.58V11C16.75 8.38 14.62 6.25 12 6.25C9.38 6.25 7.25 8.38 7.25 11V14.58L6.25 16.25Z" />
      <path d="M10 18C10.35 19 11.02 19.75 12 19.75C12.98 19.75 13.65 19 14 18" />
    </SvgIcon>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 5V19" />
      <path d="M5 12H19" />
    </SvgIcon>
  )
}

export function MinusIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M5 12H19" />
    </SvgIcon>
  )
}

export function PauseIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M9 5.75V18.25" />
      <path d="M15 5.75V18.25" />
    </SvgIcon>
  )
}

export function PlayIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M8.25 5.75L18.25 12L8.25 18.25V5.75Z" />
    </SvgIcon>
  )
}

export function CalendarIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M7 4.75V7.25" />
      <path d="M17 4.75V7.25" />
      <rect x="4" y="6.25" width="16" height="13.5" rx="2.25" />
      <path d="M4 9.75H20" />
      <path d="M8 13H8.01" />
      <path d="M12 13H12.01" />
      <path d="M16 13H16.01" />
      <path d="M8 17H8.01" />
      <path d="M12 17H12.01" />
      <path d="M16 17H16.01" />
    </SvgIcon>
  )
}

export function CalendarPageIcon(props: IconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 16 16" fill="currentColor" stroke="none">
      <path
        fillRule="evenodd"
        d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5zM2 2a1 1 0 0 0-1 1v1h14V3a1 1 0 0 0-1-1H2zm13 3H1v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V5z"
      />
      <path d="M11 7.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1zm-3 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1zm-2 3a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1zm-3 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5v-1z" />
    </SvgIcon>
  )
}

export function ClockIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="7.25" />
      <path d="M12 8V12.25L15 14" />
    </SvgIcon>
  )
}

export function TimelinePageIcon(props: IconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 36 36" fill="currentColor" stroke="none">
      <path d="M10 18c0-1.3-0.8-2.4-2-2.8v-3.4c1.2-0.4 2-1.5 2-2.8c0-1.7-1.3-3-3-3S4 7.3 4 9c0 1.3 0.8 2.4 2 2.8v3.4c-1.2 0.4-2 1.5-2 2.8s0.8 2.4 2 2.8v3.4c-1.2 0.4-2 1.5-2 2.8c0 1.7 1.3 3 3 3s3-1.3 3-3c0-1.3-0.8-2.4-2-2.8v-3.4c1.2-0.4 2-1.5 2-2.8z" />
      <path d="M31 10H15c-0.6 0-1-0.4-1-1s0.4-1 1-1h16c0.6 0 1 0.4 1 1s-0.4 1-1 1z" />
      <path d="M31 19H15c-0.6 0-1-0.4-1-1s0.4-1 1-1h16c0.6 0 1 0.4 1 1s-0.4 1-1 1z" />
      <path d="M31 28H15c-0.6 0-1-0.4-1-1s0.4-1 1-1h16c0.6 0 1 0.4 1 1s-0.4 1-1 1z" />
    </SvgIcon>
  )
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M15 18L9 12L15 6" />
    </SvgIcon>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M9 6L15 12L9 18" />
    </SvgIcon>
  )
}

export function ShoppingBagIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M6.5 8.25H17.5L18.65 18.3C18.78 19.43 17.9 20.42 16.76 20.42H7.24C6.1 20.42 5.22 19.43 5.35 18.3L6.5 8.25Z" />
      <path d="M9 9V7.25C9 5.59 10.34 4.25 12 4.25C13.66 4.25 15 5.59 15 7.25V9" />
      <path d="M9.25 11.75V12.25" />
      <path d="M14.75 11.75V12.25" />
    </SvgIcon>
  )
}

export function ShoppingCartIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1H5L7.68 14.39A2 2 0 0 0 9.68 16H19.4A2 2 0 0 0 21.4 14.39L23 6H6" />
    </SvgIcon>
  )
}

export function SpheresIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="8" cy="8" r="2.25" />
      <circle cx="16" cy="8" r="2.25" />
      <circle cx="8" cy="16" r="2.25" />
      <circle cx="16" cy="16" r="2.25" />
    </SvgIcon>
  )
}

export function SpheresChartIcon({ strokeWidth = 4, ...props }: IconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 48 48" strokeWidth={strokeWidth}>
      <path d="M6 6V42H42" />
      <path d="M14 30V34" />
      <path d="M22 22V34" />
      <path d="M30 6V34" />
      <path d="M38 14V34" />
    </SvgIcon>
  )
}

export function ChatIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M7 18L4.75 20V7C4.75 5.76 5.76 4.75 7 4.75H17C18.24 4.75 19.25 5.76 19.25 7V15C19.25 16.24 18.24 17.25 17 17.25H8.25" />
      <path d="M8 9.5H16" />
      <path d="M8 13H13.5" />
    </SvgIcon>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4.75 8C4.75 6.76 5.76 5.75 7 5.75H9.4L11.1 7.5H17C18.24 7.5 19.25 8.51 19.25 9.75V17C19.25 18.24 18.24 19.25 17 19.25H7C5.76 19.25 4.75 18.24 4.75 17V8Z" />
      <path d="M4.75 10H19.25" />
    </SvgIcon>
  )
}

export function DownloadIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 4.75V14.25" />
      <path d="M8.5 10.75L12 14.25L15.5 10.75" />
      <path d="M5 19.25H19" />
    </SvgIcon>
  )
}

export function UploadIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M12 19.25V9.75" />
      <path d="M8.5 13.25L12 9.75L15.5 13.25" />
      <path d="M5 4.75H19" />
    </SvgIcon>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M4.75 7H19.25" />
      <path d="M4.75 12H19.25" />
      <path d="M4.75 17H19.25" />
    </SvgIcon>
  )
}

export function MoreIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="6.75" cy="12" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="0.85" fill="currentColor" stroke="none" />
      <circle cx="17.25" cy="12" r="0.85" fill="currentColor" stroke="none" />
    </SvgIcon>
  )
}

export function MoreSlidersIcon(props: IconProps) {
  return (
    <SvgIcon {...props} viewBox="0 0 66 66" fill="currentColor" stroke="none">
      <path d="M10.881 17c-1.104 0-2-0.896-2-2V2c0-1.104 0.896-2 2-2s2 0.896 2 2v13c0 1.104-0.896 2-2 2z" />
      <path d="M10.881 66c-1.104 0-2-0.896-2-2V33c0-1.104 0.896-2 2-2s2 0.896 2 2v31c0 1.104-0.896 2-2 2z" />
      <path d="M10.5 34.907c-5.664 0-10.271-4.607-10.271-10.271S4.836 14.365 10.5 14.365s10.271 4.607 10.271 10.271c0 5.663-4.607 10.271-10.271 10.271zM10.5 18.364c-3.458 0-6.271 2.812-6.271 6.271s2.813 6.271 6.271 6.271s6.271-2.813 6.271-6.271S13.958 18.364 10.5 18.364z" />
      <path d="M12.36 22.29c-0.063 0-0.129-0.006-0.193-0.019l-0.278-0.055c-0.542-0.106-0.896-0.633-0.789-1.174c0.106-0.542 0.631-0.896 1.174-0.789l0.278 0.055c0.542 0.106 0.896 0.633 0.789 1.174c-0.094 0.478-0.512 0.808-0.981 0.808z" />
      <path d="M7.071 26.636c-0.553 0-1-0.447-1-1c0-1.938 1.047-3.746 2.731-4.713c0.479-0.274 1.091-0.11 1.365 0.369c0.275 0.479 0.109 1.091-0.369 1.365c-1.065 0.611-1.728 1.753-1.728 2.979c0.001 0.552-0.446 1-0.999 1z" />
      <path d="M32.881 35c-1.104 0-2-0.896-2-2V2c0-1.104 0.896-2 2-2s2 0.896 2 2v31c0 1.104-0.896 2-2 2z" />
      <path d="M32.881 66c-1.104 0-2-0.896-2-2V51c0-1.104 0.896-2 2-2s2 0.896 2 2v13c0 1.104-0.896 2-2 2z" />
      <path d="M32.5 52.907c-5.664 0-10.271-4.607-10.271-10.271c0-5.663 4.607-10.271 10.271-10.271c5.665 0 10.271 4.606 10.271 10.271S38.165 52.907 32.5 52.907zM32.5 36.364c-3.458 0-6.271 2.812-6.271 6.271s2.813 6.271 6.271 6.271s6.271-2.813 6.271-6.271s-2.813-6.271-6.271-6.271z" />
      <path d="M34.36 40.29c-0.062 0-0.129-0.006-0.193-0.019l-0.277-0.056c-0.542-0.106-0.896-0.633-0.789-1.174c0.106-0.543 0.632-0.897 1.174-0.789l0.277 0.056c0.543 0.105 0.896 0.633 0.789 1.174c-0.094 0.478-0.512 0.808-0.981 0.808z" />
      <path d="M29.071 44.636c-0.553 0-1-0.446-1-1c0-1.938 1.047-3.745 2.731-4.713c0.48-0.274 1.091-0.11 1.365 0.369c0.275 0.479 0.109 1.091-0.369 1.365c-1.065 0.61-1.728 1.753-1.728 2.979c0.001 0.552-0.446 1-0.999 1z" />
      <path d="M55.881 10c-1.104 0-2-0.896-2-2V2c0-1.104 0.896-2 2-2s2 0.896 2 2v6c0 1.104-0.896 2-2 2z" />
      <path d="M55.881 66c-1.104 0-2-0.896-2-2V26c0-1.104 0.896-2 2-2s2 0.896 2 2v38c0 1.104-0.896 2-2 2z" />
      <path d="M55.5 27.907c-5.664 0-10.271-4.607-10.271-10.271S49.836 7.365 55.5 7.365s10.271 4.607 10.271 10.271c0 5.663-4.606 10.271-10.271 10.271zM55.5 11.364c-3.459 0-6.271 2.812-6.271 6.271s2.812 6.271 6.271 6.271c3.457 0 6.271-2.813 6.271-6.271s-2.813-6.271-6.271-6.271z" />
      <path d="M57.36 15.29c-0.062 0-0.129-0.006-0.193-0.019l-0.277-0.055c-0.542-0.106-0.896-0.633-0.789-1.174c0.105-0.542 0.632-0.896 1.174-0.789l0.277 0.055c0.543 0.106 0.896 0.633 0.789 1.174c-0.094 0.478-0.512 0.808-0.981 0.808z" />
      <path d="M52.071 19.636c-0.553 0-1-0.447-1-1c0-1.938 1.047-3.746 2.73-4.713c0.479-0.273 1.091-0.109 1.365 0.369c0.275 0.479 0.109 1.091-0.369 1.365c-1.064 0.611-1.728 1.753-1.728 2.979c0.002 0.552-0.445 1-0.998 1z" />
    </SvgIcon>
  )
}

export function LightningIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M13.25 3.75L5.75 13.1H11.25L10.75 20.25L18.25 10.6H12.75L13.25 3.75Z" />
    </SvgIcon>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <path d="M19.25 15.2C17.98 15.9 16.52 16.25 15 16.25C10.44 16.25 6.75 12.56 6.75 8C6.75 6.48 7.1 5.02 7.8 3.75C4.82 5.16 2.75 8.19 2.75 11.7C2.75 16.56 6.69 20.5 11.55 20.5C15.06 20.5 18.09 18.18 19.25 15.2Z" />
    </SvgIcon>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="3.7" />
      <path d="M12 3.25V5.25" />
      <path d="M12 18.75V20.75" />
      <path d="M3.25 12H5.25" />
      <path d="M18.75 12H20.75" />
      <path d="M5.8 5.8L7.22 7.22" />
      <path d="M16.78 16.78L18.2 18.2" />
      <path d="M18.2 5.8L16.78 7.22" />
      <path d="M7.22 16.78L5.8 18.2" />
    </SvgIcon>
  )
}
