/** Minimal inline icon set — avoids shipping an icon font for ~12 glyphs. */
type P = { className?: string }

const base = 'w-6 h-6'

export const PlayIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.7-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
  </svg>
)

export const PauseIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
  </svg>
)

export const PlusIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
)

export const CheckIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className} aria-hidden>
    <path d="m4 12.5 5 5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const WatchedIcon = ({ className = base, filled = false }: P & { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden>
    <circle
      cx="12"
      cy="12"
      r="9"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <path
      d="m8 12.2 2.7 2.7L16 9.6"
      fill="none"
      stroke={filled ? '#0a0a0b' : 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

export const InfoIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.6v.4" strokeLinecap="round" />
  </svg>
)

export const ChevronLeft = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className={className} aria-hidden>
    <path d="m15 5-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const ChevronRight = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className={className} aria-hidden>
    <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const ChevronDown = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const SearchIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
  </svg>
)

export const VolumeIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M11 5 6.5 8.5H3v7h3.5L11 19z" />
    <path
      d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
)

export const MuteIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <path d="M11 5 6.5 8.5H3v7h3.5L11 19z" />
    <path
      d="m16 9.5 5 5m0-5-5 5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    />
  </svg>
)

export const FullscreenIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const ExitFullscreenIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const SubtitlesIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="M7 14.5h4M13 14.5h4" strokeLinecap="round" />
  </svg>
)

export const BackIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
    <path d="M20 12H4m0 0 6-6m-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const GearIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={className} aria-hidden>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9.1a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03Z" />
  </svg>
)

export const CastIcon = ({ className = base }: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
    <path d="M3 18.5a2.5 2.5 0 0 1 2.5 2.5M3 14.5a6.5 6.5 0 0 1 6.5 6.5M3 10.5a10.5 10.5 0 0 1 10.5 10.5" strokeLinecap="round" />
    <path d="M8 5.5h11.5a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H17" strokeLinecap="round" />
  </svg>
)

export const NextTrackIcon = ({ className = base, back = false }: P & { back?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
    <g transform={back ? 'scale(-1,1) translate(-24,0)' : undefined}>
      <path d="M5 5.5v13a1 1 0 0 0 1.54.84l9.2-6.5a1 1 0 0 0 0-1.68l-9.2-6.5A1 1 0 0 0 5 5.5Z" />
      <rect x="17" y="5" width="2.6" height="14" rx="1.1" />
    </g>
  </svg>
)

export const RepeatIcon = ({ className = base, one = false }: P & { one?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className} aria-hidden>
    <path d="M4 12V9.5A3.5 3.5 0 0 1 7.5 6H19M19 6l-3-3M19 6l-3 3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 12v2.5a3.5 3.5 0 0 1-3.5 3.5H5M5 18l3 3M5 18l3-3" strokeLinecap="round" strokeLinejoin="round" />
    {one && (
      <text x="12" y="14.5" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor" stroke="none">
        1
      </text>
    )}
  </svg>
)

export const Skip10Icon = ({ className = base, back = false }: P & { back?: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
    <g transform={back ? 'scale(-1,1) translate(-24,0)' : undefined}>
      <path d="M12 6a8 8 0 1 0 7.4 5" strokeLinecap="round" />
      <path d="M13 2.5 19.5 6 16 9.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <text
      x="12"
      y="16.5"
      textAnchor="middle"
      fontSize="7.5"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
    >
      10
    </text>
  </svg>
)
