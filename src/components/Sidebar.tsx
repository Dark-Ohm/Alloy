import { useStore } from '@/store'
import {
  Package, ArrowDownToLine, RefreshCw, Wrench, FileText, Settings,
  CheckCircle2, XCircle, Rocket, Newspaper
} from 'lucide-react'
import clsx from 'clsx'

const NAV = [
  { id: 'news' as const, label: "What's New", icon: Newspaper },
  { id: 'drop' as const, label: 'Drop Zone', icon: ArrowDownToLine },
  { id: 'packages' as const, label: 'Packages', icon: Package },
  { id: 'update' as const, label: 'System Update', icon: RefreshCw },
  { id: 'apps' as const, label: 'Applications', icon: Rocket },
  { id: 'maintenance' as const, label: 'Maintenance', icon: Wrench },
  { id: 'config' as const, label: 'PKGBUILD Review', icon: FileText },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const currentPage = useStore((s) => s.currentPage)
  const setPage = useStore((s) => s.setPage)
  const deps = useStore((s) => s.deps)
  const depsLoading = useStore((s) => s.depsLoading)
  const checkDeps = useStore((s) => s.checkDeps)

  return (
    <aside className="w-56 bg-dark-800 border-r border-dark-500 flex flex-col shrink-0">
      <div className="px-5 py-5 border-b border-dark-500">
        <h1 className="text-lg font-bold text-accent-blue tracking-tight">ALLOY</h1>
        <p className="text-[11px] text-text-muted mt-0.5">Arch Package Dropper</p>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={clsx('sidebar-item w-full', { active: currentPage === item.id })}
            >
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="px-4 py-4 border-t border-dark-500">
        <button
          onClick={checkDeps}
          disabled={depsLoading}
          className="text-[11px] text-text-muted hover:text-text-secondary transition-colors w-full text-left"
        >
          {depsLoading ? 'Checking deps...' : '↻ Check System Deps'}
        </button>
        {deps && (
          <div className="mt-2 space-y-1">
            <DepBadge name="pacman" ok={deps.pacman.installed} />
            <DepBadge name="yay" ok={deps.yay.installed} />
            <DepBadge name="debtap" ok={deps.debtap.installed} />
            <DepBadge name="fish" ok={deps.fish.installed} />
          </div>
        )}
      </div>
    </aside>
  )
}

function DepBadge({ name, ok }: { name: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      {ok
        ? <CheckCircle2 size={10} className="text-accent-green" />
        : <XCircle size={10} className="text-accent-red" />
      }
      <span className={ok ? 'text-text-muted' : 'text-accent-red'}>{name}</span>
    </div>
  )
}
