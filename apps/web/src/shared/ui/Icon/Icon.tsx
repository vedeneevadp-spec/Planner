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

export function ClockIcon(props: IconProps) {
  return (
    <SvgIcon {...props}>
      <circle cx="12" cy="12" r="7.25" />
      <path d="M12 8V12.25L15 14" />
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
