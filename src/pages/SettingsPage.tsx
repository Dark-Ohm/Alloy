import { useEffect, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '@/store'
import { Card, ActionButton, ErrorBanner, SectionTitle, Spinner } from '@/components/ui'
import { Settings, Monitor, Shield, Zap, RotateCcw } from 'lucide-react'

// Default values for settings reset
const DEFAULTS: Record<string, Record<string, unknown>> = {
  general: {
    confirm_before_upgrade: true,
    confirm_before_remove: true,
    pkgbuild_review: true,
    verify_signatures: true,
    nodeps_foreign: false,
  },
  cache: {
    keep_versions: 3,
  },
  aur: {
    enable_aur: true,
    check_informant: true,
  },
  wayland: {
    prefer_wayland: false,
    kde_polkit: false,
    kstart5_launch: false,
  },
}

export function SettingsPage() {
  const store = useStore()
  const [cfg, setCfg] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    invoke<Record<string, unknown>>('get_config')
      .then(setCfg)
      .catch(() => setCfg({}))
      .finally(() => setLoading(false))
  }, [])

  const save = useCallback(async (section: string, key: string, value: unknown) => {
    const saveKey = `${section}.${key}`
    setSaving(saveKey)
    try {
      await invoke('set_config', { section, key, value: value as never })
      setCfg((prev) => ({
        ...prev,
        [section]: { ...(prev[section] as Record<string, unknown> || {}), [key]: value },
      }))
    } catch (e) {
      store.setErrorBanner(`Failed to save setting: ${e}`)
      invoke<Record<string, unknown>>('get_config').then(setCfg).catch(() => {})
    } finally {
      setSaving(null)
    }
  }, [store])

  const resetSection = useCallback(async (section: string) => {
    if (!DEFAULTS[section]) return
    setSaving(`${section}.reset`)
    try {
      for (const [key, value] of Object.entries(DEFAULTS[section])) {
        await invoke('set_config', { section, key, value: value as never })
      }
      setCfg((prev) => ({
        ...prev,
        [section]: { ...DEFAULTS[section] },
      }))
    } catch (e) {
      store.setErrorBanner(`Failed to reset: ${e}`)
    } finally {
      setSaving(null)
    }
  }, [store])

  const g = (cfg.general as Record<string, unknown>) || {}
  const c = (cfg.cache as Record<string, unknown>) || {}
  const a = (cfg.aur as Record<string, unknown>) || {}
  const w = (cfg.wayland as Record<string, unknown>) || {}

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-text-muted">
          <Spinner size={18} className="text-accent-blue" />
          <span>Loading settings...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <SectionTitle icon={<Settings size={20} className="text-text-muted" />}>Settings</SectionTitle>
      {store.errorBanner && <ErrorBanner message={store.errorBanner} onDismiss={store.dismissError} />}

      <SettingsCard
        title="General"
        description="Basic behavior and confirmation preferences"
        icon={<Settings size={16} className="text-text-muted" />}
        onReset={() => resetSection('general')}
        saving={saving?.startsWith('general')}
      >
        <ToggleRow
          label="Confirm before system upgrade"
          description="Show confirmation dialog before pacman -Syu"
          checked={!!g.confirm_before_upgrade}
          saving={saving === 'general.confirm_before_upgrade'}
          onChange={(v) => save('general', 'confirm_before_upgrade', v)}
        />
        <ToggleRow
          label="Confirm before package removal"
          description="Ask before removing packages with dependencies"
          checked={!!g.confirm_before_remove}
          saving={saving === 'general.confirm_before_remove'}
          onChange={(v) => save('general', 'confirm_before_remove', v)}
        />
        <ToggleRow
          label="PKGBUILD review before AUR install"
          description="Show PKGBUILD content before installing AUR packages"
          checked={!!g.pkgbuild_review}
          saving={saving === 'general.pkgbuild_review'}
          onChange={(v) => save('general', 'pkgbuild_review', v)}
        />
      </SettingsCard>

      <SettingsCard
        title="Cache"
        description="Package cache retention settings"
        icon={<Zap size={16} className="text-accent-blue" />}
        onReset={() => resetSection('cache')}
        saving={saving?.startsWith('cache')}
      >
        <NumberRow
          label="Keep package versions"
          description="How many old versions to keep in pacman cache"
          value={c.keep_versions as number ?? 3}
          saving={saving === 'cache.keep_versions'}
          onChange={(v) => save('cache', 'keep_versions', v)}
        />
      </SettingsCard>

      <SettingsCard
        title="AUR"
        description="Arch User Repository integration"
        icon={<Shield size={16} className="text-accent-purple" />}
        onReset={() => resetSection('aur')}
        saving={saving?.startsWith('aur')}
      >
        <ToggleRow
          label="Enable AUR packages"
          description="Allow searching and installing from AUR"
          checked={!!a.enable_aur}
          saving={saving === 'aur.enable_aur'}
          onChange={(v) => save('aur', 'enable_aur', v)}
        />
        <ToggleRow
          label="Check Arch news before upgrade"
          description="Use informant to detect breaking updates"
          checked={!!a.check_informant}
          saving={saving === 'aur.check_informant'}
          onChange={(v) => save('aur', 'check_informant', v)}
        />
      </SettingsCard>

      <SettingsCard
        title="Wayland / KDE Plasma 6"
        description="Desktop environment integration options"
        icon={<Monitor size={16} className="text-accent-cyan" />}
        onReset={() => resetSection('wayland')}
        saving={saving?.startsWith('wayland')}
      >
        <ToggleRow
          label="Prefer Wayland native dialogs"
          description="Use Wayland file pickers when available"
          checked={!!w.prefer_wayland}
          saving={saving === 'wayland.prefer_wayland'}
          onChange={(v) => save('wayland', 'prefer_wayland', v)}
        />
        <ToggleRow
          label="Use KDE Polkit agent"
          description="Use KDE's polkit implementation for sudo prompts"
          checked={!!w.kde_polkit}
          saving={saving === 'wayland.kde_polkit'}
          onChange={(v) => save('wayland', 'kde_polkit', v)}
        />
        <ToggleRow
          label="Launch apps via kstart5"
          description="Use KDE's app launcher for application integration"
          checked={!!w.kstart5_launch}
          saving={saving === 'wayland.kstart5_launch'}
          onChange={(v) => save('wayland', 'kstart5_launch', v)}
        />
      </SettingsCard>

      <SettingsCard
        title="Security"
        description="Package verification and security options"
        icon={<Shield size={16} className="text-accent-green" />}
        onReset={() => resetSection('general')}
        saving={saving?.startsWith('general')}
      >
        <ToggleRow
          label="Verify package signatures"
          description="Check PGP signatures for packages when installing"
          checked={!!g.verify_signatures}
          saving={saving === 'general.verify_signatures'}
          onChange={(v) => save('general', 'verify_signatures', v)}
        />
        <ToggleRow
          label="Use --nodeps for foreign packages"
          description="Skip dependency checks when installing converted packages"
          checked={!!g.nodeps_foreign}
          saving={saving === 'general.nodeps_foreign'}
          onChange={(v) => save('general', 'nodeps_foreign', v)}
        />
      </SettingsCard>
    </div>
  )
}

function SettingsCard({
  title,
  description,
  icon,
  onReset,
  saving,
  children,
}: {
  title: string
  description: string
  icon: React.ReactNode
  onReset: () => void
  saving?: boolean
  children: React.ReactNode
}) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="font-semibold text-text-primary">{title}</h3>
          </div>
          <p className="text-xs text-text-muted mt-1">{description}</p>
        </div>
        <ActionButton variant="ghost" onClick={onReset} disabled={!!saving} >
          <RotateCcw size={14} />
        </ActionButton>
      </div>
      <div className="space-y-4 pt-2 border-t border-dark-500">
        {children}
      </div>
    </Card>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  saving,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  saving?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="flex-1 pr-3">
        <p className="text-sm text-text-primary font-medium">{label}</p>
        <p className="text-xs text-text-muted mt-0.5">{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          disabled={saving}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only peer"
        />
        <div className={`w-11 h-6 bg-dark-500 rounded-full peer peer-checked:bg-accent-blue transition-colors ${saving ? 'opacity-50' : ''}`}>
          <div className={`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'} mt-0.5`} />
        </div>
      </label>
    </div>
  )
}

function NumberRow({
  label,
  description,
  value,
  saving,
  onChange,
}: {
  label: string
  description: string
  value: number
  saving?: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <div className="flex-1 pr-3">
        <p className="text-sm text-text-primary font-medium">{label}</p>
        <p className="text-xs text-text-muted mt-0.5">{description}</p>
      </div>
      <input
        type="number"
        min={0}
        max={10}
        value={value}
        disabled={saving}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="input w-20 py-1 text-xs disabled:opacity-50"
      />
    </div>
  )
}
