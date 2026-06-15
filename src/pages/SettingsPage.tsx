import { useEffect, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '@/store'
import { Card, SectionTitle, ErrorBanner } from '@/components/ui'
import { Settings, Monitor, Shield, Zap } from 'lucide-react'

export function SettingsPage() {
  const store = useStore()
  const [cfg, setCfg] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    invoke<Record<string, unknown>>('get_config').then(setCfg).catch(() => {})
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
      // Revert: re-fetch config from backend
      invoke<Record<string, unknown>>('get_config').then(setCfg).catch(() => {})
    } finally {
      setSaving(null)
    }
  }, [store])

  const g = (cfg.general as Record<string, unknown>) || {}
  const c = (cfg.cache as Record<string, unknown>) || {}
  const a = (cfg.aur as Record<string, unknown>) || {}
  const w = (cfg.wayland as Record<string, unknown>) || {}

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <SectionTitle icon={<Settings size={20} className="text-text-muted" />}>Settings</SectionTitle>
      {store.errorBanner && <ErrorBanner message={store.errorBanner} onDismiss={store.dismissError} />}

      <Card>
        <h3 className="font-semibold text-text-primary mb-3">General</h3>
        <div className="space-y-3">
          <label className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Confirm before system upgrade</span>
            <input type="checkbox" checked={!!g.confirm_before_upgrade} disabled={saving === 'general.confirm_before_upgrade'} className="w-4 h-4 rounded accent-accent-blue" onChange={(e) => save('general', 'confirm_before_upgrade', e.target.checked)} />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Confirm before package removal</span>
            <input type="checkbox" checked={!!g.confirm_before_remove} disabled={saving === 'general.confirm_before_remove'} className="w-4 h-4 rounded accent-accent-blue" onChange={(e) => save('general', 'confirm_before_remove', e.target.checked)} />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">PKGBUILD review before AUR install</span>
            <input type="checkbox" checked={!!g.pkgbuild_review} disabled={saving === 'general.pkgbuild_review'} className="w-4 h-4 rounded accent-accent-blue" onChange={(e) => save('general', 'pkgbuild_review', e.target.checked)} />
          </label>
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold text-text-primary mb-3">Cache</h3>
        <div className="space-y-3">
          <label className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Keep versions</span>
            <input type="number" min={0} max={10} className="input w-20 py-1 text-xs" value={c.keep_versions as number ?? 3} onChange={(e) => save('cache', 'keep_versions', Math.max(0, Math.min(10, parseInt(e.target.value) || 0)))} />
          </label>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Zap size={16} className="text-accent-purple" />
          <h3 className="font-semibold text-text-primary">AUR</h3>
        </div>
        <div className="space-y-3">
          <label className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Enable AUR packages</span>
            <input type="checkbox" checked={!!a.enable_aur} disabled={saving === 'aur.enable_aur'} className="w-4 h-4 rounded accent-accent-blue" onChange={(e) => save('aur', 'enable_aur', e.target.checked)} />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Check Arch news before upgrade (informant)</span>
            <input type="checkbox" checked={!!a.check_informant} disabled={saving === 'aur.check_informant'} className="w-4 h-4 rounded accent-accent-blue" onChange={(e) => save('aur', 'check_informant', e.target.checked)} />
          </label>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Monitor size={16} className="text-accent-cyan" />
          <h3 className="font-semibold text-text-primary">Wayland / KDE Plasma 6</h3>
        </div>
        <div className="space-y-3">
          <label className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Prefer Wayland native dialogs</span>
            <input type="checkbox" checked={!!w.prefer_wayland} disabled={saving === 'wayland.prefer_wayland'} className="w-4 h-4 rounded accent-accent-blue" onChange={(e) => save('wayland', 'prefer_wayland', e.target.checked)} />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Use KDE Polkit agent (kdesu)</span>
            <input type="checkbox" checked={!!w.kde_polkit} disabled={saving === 'wayland.kde_polkit'} className="w-4 h-4 rounded accent-accent-blue" onChange={(e) => save('wayland', 'kde_polkit', e.target.checked)} />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Launch apps via kstart5 (KDE)</span>
            <input type="checkbox" checked={!!w.kstart5_launch} disabled={saving === 'wayland.kstart5_launch'} className="w-4 h-4 rounded accent-accent-blue" onChange={(e) => save('wayland', 'kstart5_launch', e.target.checked)} />
          </label>
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Shield size={16} className="text-accent-green" />
          <h3 className="font-semibold text-text-primary">Security</h3>
        </div>
        <div className="space-y-3">
          <label className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Verify package signatures</span>
            <input type="checkbox" checked={!!g.verify_signatures} disabled={saving === 'general.verify_signatures'} className="w-4 h-4 rounded accent-accent-blue" onChange={(e) => save('general', 'verify_signatures', e.target.checked)} />
          </label>
          <label className="flex items-center justify-between">
            <span className="text-sm text-text-secondary">Use --nodeps for foreign packages</span>
            <input type="checkbox" checked={!!g.nodeps_foreign} disabled={saving === 'general.nodeps_foreign'} className="w-4 h-4 rounded accent-accent-blue" onChange={(e) => save('general', 'nodeps_foreign', e.target.checked)} />
          </label>
        </div>
      </Card>
    </div>
  )
}
