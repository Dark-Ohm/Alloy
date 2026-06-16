import clsx from 'clsx'

export function Spinner({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
      <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-80" />
    </svg>
  )
}

export function ProgressBar({ value, label, color = 'blue' }: {
  value: number; label?: string; color?: 'blue' | 'green' | 'red' | 'yellow'
}) {
  const colors: Record<string, string> = {
    blue: 'bg-accent-blue', green: 'bg-accent-green', red: 'bg-accent-red', yellow: 'bg-accent-yellow',
  }
  return (
    <div className="space-y-1">
      <div className="h-2 bg-dark-500 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ease-out ${colors[color]}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      {label && <p className="text-[11px] text-text-muted truncate">{label}</p>}
    </div>
  )
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 bg-accent-red/10 border border-accent-red/30 rounded-xl p-4 animate-fade-in shrink-0">
      <svg className="w-5 h-5 text-accent-red shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-accent-red">Error</p>
        <p className="text-xs text-accent-red/80 mt-1 break-words font-mono">{message}</p>
      </div>
      <button onClick={onDismiss} className="text-accent-red/60 hover:text-accent-red transition-colors text-lg leading-none">×</button>
    </div>
  )
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 bg-accent-green/10 border border-accent-green/30 rounded-xl p-4 animate-fade-in">
      <svg className="w-5 h-5 text-accent-green shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p className="text-sm text-accent-green font-medium">{message}</p>
    </div>
  )
}

export function LogConsole({ lines, maxHeight = 220, className = '' }: { lines: string[]; maxHeight?: number; className?: string }) {
  return (
    <div className={`font-mono text-[11px] leading-5 bg-dark-900 text-text-secondary rounded-xl p-4 overflow-auto whitespace-pre-wrap border border-dark-500 ${className}`} style={className ? undefined : { maxHeight }}>
      {lines.length === 0
        ? <span className="text-text-muted italic">Waiting for output...</span>
        : lines.map((line, i) => (
          <div key={i} className={clsx(
            (line.startsWith('⚠') || line.toLowerCase().includes('error')) && 'text-accent-red',
            (line.startsWith('✓') || line.toLowerCase().includes('complete')) && 'text-accent-green',
            line.startsWith('→') && 'text-accent-cyan',
            line.startsWith('↓') && 'text-accent-purple',
          )}>{line}</div>
        ))
      }
    </div>
  )
}

export function SectionTitle({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-1 shrink-0">
      {icon}
      <h2 className="text-base font-semibold text-text-primary">{children}</h2>
    </div>
  )
}

export function ActionButton({ children, variant = 'primary', onClick, disabled, className, title }: {
  children: React.ReactNode
  variant?: 'primary' | 'success' | 'danger' | 'warning' | 'ghost'
  onClick?: () => void
  disabled?: boolean
  className?: string
  title?: string
}) {
  const base = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 cursor-pointer select-none border border-transparent disabled:opacity-50 disabled:cursor-not-allowed'
  const variants: Record<string, string> = {
    primary: 'bg-accent-blue text-dark-900 hover:brightness-110 font-semibold',
    success: 'bg-accent-green text-dark-900 hover:brightness-110 font-semibold',
    danger: 'bg-accent-red text-dark-900 hover:brightness-110 font-semibold',
    warning: 'bg-accent-yellow text-dark-900 hover:brightness-110 font-semibold',
    ghost: 'bg-dark-500 border-dark-400 hover:bg-dark-400 text-text-primary',
  }
  return <button onClick={onClick} disabled={disabled} title={title} className={`${base} ${variants[variant]} ${className ?? ''}`}>{children}</button>
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-dark-600 border border-dark-400 rounded-2xl p-5 ${className ?? ''}`}>{children}</div>
}

export function Badge({ children, color = 'blue' }: { children: React.ReactNode; color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple' }) {
  const colors: Record<string, string> = {
    blue: 'bg-accent-blue/15 text-accent-blue',
    green: 'bg-accent-green/15 text-accent-green',
    red: 'bg-accent-red/15 text-accent-red',
    yellow: 'bg-accent-yellow/15 text-accent-yellow',
    purple: 'bg-accent-purple/15 text-accent-purple',
  }
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium ${colors[color]}`}>{children}</span>
}
