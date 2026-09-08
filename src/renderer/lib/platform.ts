import type { PlatformId } from '@shared/ipc'

/** Only reached if the preload bridge is missing, which in the packaged app it never is. */
function guessFromUserAgent(): PlatformId {
  const ua = navigator.userAgent
  if (ua.includes('Windows')) return 'win32'
  if (ua.includes('Mac')) return 'darwin'
  return 'linux'
}

export const platform: PlatformId = window.api?.platform ?? guessFromUserAgent()
export const isMac = platform === 'darwin'

/**
 * Labels a shortcut the way the host platform writes it: `⌘S` on macOS, `Ctrl+S` elsewhere.
 * The handlers themselves accept either modifier, so this is only ever about what people read.
 */
export function shortcut(key: string, modifiers: { shift?: boolean } = {}): string {
  if (isMac) return `${modifiers.shift ? '⇧' : ''}⌘${key === 'Enter' ? '↩' : key}`
  return `Ctrl+${modifiers.shift ? 'Shift+' : ''}${key}`
}
