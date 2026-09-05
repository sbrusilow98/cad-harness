import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { Theme } from '@shared/types'
import { SettingsStore } from './settings'
import { SecretStore } from './secrets'
import { electronCipher } from './secrets-electron'
import { McpRegistry } from './mcp/registry'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null

function createWindow(theme: Theme): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: theme === 'dark' ? '#0e0e0e' : '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  const userData = app.getPath('userData')
  const settings = new SettingsStore(join(userData, 'settings.json'))
  const secrets = new SecretStore(join(userData, 'secrets.bin'), electronCipher())
  const mcp = new McpRegistry(() => settings.get().mcpServers)

  registerIpc({ settings, secrets, mcp, getWindow: () => mainWindow })
  createWindow(settings.get().theme)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(settings.get().theme)
  })
  app.on('before-quit', () => {
    void mcp.closeAll()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
