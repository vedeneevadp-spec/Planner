import { appIcons } from './app-icons'

export function IconGallery() {
  const entries = Object.entries(appIcons)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 16,
        padding: 24,
        color: 'currentColor',
      }}
    >
      {entries.map(([name, Icon]) => (
        <div
          key={name}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            padding: 16,
            border: '1px solid currentColor',
            borderRadius: 16,
            opacity: 0.9,
          }}
        >
          <Icon size={24} strokeWidth={2} />
          <span style={{ fontSize: 12 }}>{name}</span>
        </div>
      ))}
    </div>
  )
}
