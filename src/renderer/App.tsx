import { useEffect } from 'react'
import '@/styles/theme.css'
import '@/styles/app.css'
import { useUiStore } from '@/store/ui'
import { TopBar } from '@/components/TopBar'
import { Canvas } from '@/components/Canvas'
import { Inspector } from '@/components/Inspector'
import { RunConsole } from '@/components/RunConsole'
import { SettingsDialog } from '@/components/SettingsDialog'
import { useDocumentSync } from '@/lib/document-sync'

export default function App() {
  const loadSettings = useUiStore((s) => s.loadSettings)
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])
  useDocumentSync()

  return (
    <div className="app">
      <TopBar />
      <Canvas />
      <Inspector />
      <RunConsole />
      <SettingsDialog />
    </div>
  )
}
