import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import type { Theme } from '@shared/types'
import { SettingsStore } from './settings'
import { SecretStore } from './secrets'
import { electronCipher } from './secrets-electron'
import { McpRegistry } from './mcp/registry'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null
let quitting = false

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
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Close anyway', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'You have unsaved changes.',
      detail: 'Close without saving?'
    })
    // preventDefault here *allows* the unload to proceed.
    if (choice === 0) {
      event.preventDefault()
    } else {
      quitting = false
    }
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
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void Promise.race([mcp.closeAll(), new Promise<void>((resolve) => setTimeout(resolve, 3000))])
      .catch(() => undefined)
      .finally(() => app.quit())
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
