import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import type { Theme } from '@shared/types'

/** Height of the renderer's top bar, which the window controls have to sit inside. */
export const TITLE_BAR_HEIGHT = 40

/** Matches --surface / --text in src/renderer/styles/theme.css so the controls blend into the top bar. */
const OVERLAY_COLORS: Record<Theme, { color: string; symbolColor: string }> = {
  light: { color: '#fafafa', symbolColor: '#111111' },
  dark: { color: '#151515', symbolColor: '#f2f2f2' }
}

export function titleBarOverlayFor(theme: Theme): { color: string; symbolColor: string; height: number } {
  return { ...OVERLAY_COLORS[theme], height: TITLE_BAR_HEIGHT }
}

/**
 * How the frame is drawn, per platform.
 *
 * macOS hides the title bar and insets the traffic lights into the top bar. Windows hides it too but
 * draws the minimize/maximize/close buttons as an overlay on the right, which keeps the custom top
 * bar and still gives real window controls. Linux keeps its normal frame: overlay support there
 * depends on the desktop environment, and a window with no controls at all would be a trap.
 */
export function frameOptions(platform: NodeJS.Platform, theme: Theme): BrowserWindowConstructorOptions {
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } }
  if (platform === 'win32') return { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlayFor(theme) }
  return {}
}

/** Repaints the Windows control overlay after a theme change. A no-op everywhere else. */
export function applyTitleBarOverlay(win: BrowserWindow, theme: Theme, platform: NodeJS.Platform = process.platform): void {
  if (platform !== 'win32') return
  try {
    if (win.isDestroyed()) return
    win.setTitleBarOverlay(titleBarOverlayFor(theme))
  } catch {
    // The window was created without an overlay, so there is nothing to repaint. Not worth failing
    // a settings update over.
  }
}
