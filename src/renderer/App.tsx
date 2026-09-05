import { useEffect } from 'react'
import '@/styles/theme.css'
import '@/styles/app.css'
import { useUiStore } from '@/store/ui'
import { TopBar } from '@/components/TopBar'
import { Canvas } from '@/components/Canvas'
import { Inspector } from '@/components/Inspector'
import { RunConsole } from '@/components/RunConsole'

export default function App() {
  const loadSettings = useUiStore((s) => s.loadSettings)
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  return (
    <div className="app">
      <TopBar />
      <Canvas />
      <Inspector />
      <RunConsole />
    </div>
  )
}
