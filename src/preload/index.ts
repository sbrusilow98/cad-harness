import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type Api } from '@shared/ipc'
import type { RunEvent } from '@shared/events'

const api: Api = {
  openGraph: () => ipcRenderer.invoke(IPC.openGraph),
  saveGraph: (graph, path) => ipcRenderer.invoke(IPC.saveGraph, graph, path),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  setSecret: (provider, key) => ipcRenderer.invoke(IPC.setSecret, provider, key),
  hasSecret: (provider) => ipcRenderer.invoke(IPC.hasSecret, provider),
  clearSecret: (provider) => ipcRenderer.invoke(IPC.clearSecret, provider),
  listModels: (provider) => ipcRenderer.invoke(IPC.listModels, provider),
  testMcpServer: (config) => ipcRenderer.invoke(IPC.testMcp, config),
  listMcpTools: (serverId) => ipcRenderer.invoke(IPC.listMcpTools, serverId),
  startRun: (graph, input) => ipcRenderer.invoke(IPC.startRun, graph, input),
  stopRun: (runId) => ipcRenderer.invoke(IPC.stopRun, runId),
  onRunEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, event: RunEvent): void => listener(event)
    ipcRenderer.on(IPC.runEvent, handler)
    return () => {
      ipcRenderer.removeListener(IPC.runEvent, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
