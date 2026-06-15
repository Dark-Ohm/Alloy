import { useEffect } from 'react'
import { useStore } from '@/store'
import { Sidebar } from '@/components/Sidebar'
import { DropZone } from '@/components/DropZone'
import { PackagesPage } from '@/pages/PackagesPage'
import { SystemUpdatePage } from '@/pages/SystemUpdatePage'
import { MaintenancePage } from '@/pages/MaintenancePage'
import { ConfigPage } from '@/pages/ConfigPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { ApplicationsPage } from '@/pages/ApplicationsPage'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'

export default function App() {
  const currentPage = useStore((s) => s.currentPage)
  const checkDeps = useStore((s) => s.checkDeps)
  const setErrorBanner = useStore((s) => s.setErrorBanner)

  // Check for updates periodically
  useEffect(() => {
    const checkUpdates = async () => {
      try {
        const hasUpdates = await invoke<boolean>('check_for_updates')
        if (hasUpdates) {
          setErrorBanner('System updates available — check the System Update page')
        }
      } catch { /* noop */ }
    }

    // Check on startup and every 30 minutes
    checkUpdates()
    const interval = setInterval(checkUpdates, 30 * 60 * 1000)

    return () => { clearInterval(interval) }
  }, [checkDeps, setErrorBanner])

  // Handle window close → minimize to tray
  useEffect(() => {
    const unlisten = getCurrentWebview().onCloseRequested(async (event) => {
      event.preventDefault()
      await invoke('minimize_to_tray')
    })
    return () => { unlisten.then((fn: () => void) => fn()) }
  }, [])

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-dark-900">
      <Sidebar />
      <main className="flex-1 overflow-hidden">
        <div className="h-full">
          {currentPage === 'drop' && <DropZone />}
          {currentPage === 'packages' && <PackagesPage />}
          {currentPage === 'update' && <SystemUpdatePage />}
          {currentPage === 'apps' && <ApplicationsPage />}
          {currentPage === 'maintenance' && <MaintenancePage />}
          {currentPage === 'config' && <ConfigPage />}
          {currentPage === 'settings' && <SettingsPage />}
        </div>
      </main>
    </div>
  )
}
