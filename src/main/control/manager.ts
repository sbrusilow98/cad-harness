import { randomBytes } from 'node:crypto'
import type { Settings } from '@shared/types'
import { errorMessage } from '@shared/errors'
import type { ControlDeps } from './deps'
import { startControlListener, type ControlListener } from './http'

export const CONTROL_TOKEN_KEY = 'remoteControlToken'

export interface ControlStatus {
  enabled: boolean
  port: number
  /** The address to give a client, or null when the listener is not running. */
  url: string | null
  token: string
  error: string | null
}

export interface ControlManagerDeps {
  settings: { get(): Settings }
  secrets: { get(name: string): string | null; set(name: string, value: string): void }
  buildControlDeps: () => ControlDeps
}

/** Keeps the listener matching the settings, and owns the bearer token. */
export class ControlManager {
  private listener: ControlListener | null = null
  private startedWith: { port: number; token: string } | null = null
  private error: string | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: ControlManagerDeps) {}

  status(): ControlStatus {
    const settings = this.deps.settings.get().remoteControl
    return {
      enabled: settings.enabled,
      port: this.listener?.port ?? settings.port,
      url: this.listener?.url ?? null,
      token: this.deps.secrets.get(CONTROL_TOKEN_KEY) ?? '',
      error: this.error
    }
  }

  /** Serializes lifecycle work so two callers cannot start a second listener over a live one. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work)
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Starts, stops, or restarts the listener so it matches the current settings. */
  async sync(): Promise<ControlStatus> {
    return this.enqueue(() => this.applySync())
  }

  private async applySync(): Promise<ControlStatus> {
    const wanted = this.deps.settings.get().remoteControl
    let token: string
    try {
      token = this.token()
    } catch (err) {
      // Without secure storage there is no token worth guarding the listener with, so stay
      // stopped. The error only matters to someone who asked for the listener.
      await this.applyStop()
      if (wanted.enabled) this.error = errorMessage(err)
      return this.status()
    }

    if (!wanted.enabled) {
      await this.applyStop()
      return this.status()
    }

    const unchanged = this.listener !== null && this.startedWith?.port === wanted.port && this.startedWith.token === token
    if (unchanged) return this.status()

    await this.applyStop()
    try {
      this.listener = await startControlListener({ port: wanted.port, token, deps: this.deps.buildControlDeps() })
      this.startedWith = { port: wanted.port, token }
      this.error = null
    } catch (err) {
      this.listener = null
      this.startedWith = null
      this.error = errorMessage(err)
    }
    return this.status()
  }

  async regenerateToken(): Promise<ControlStatus> {
    this.deps.secrets.set(CONTROL_TOKEN_KEY, randomBytes(32).toString('hex'))
    return this.sync()
  }

  async stop(): Promise<void> {
    return this.enqueue(() => this.applyStop())
  }

  private async applyStop(): Promise<void> {
    const listener = this.listener
    this.listener = null
    this.startedWith = null
    this.error = null
    await listener?.close()
  }

  private token(): string {
    const existing = this.deps.secrets.get(CONTROL_TOKEN_KEY)
    if (existing) return existing
    const minted = randomBytes(32).toString('hex')
    this.deps.secrets.set(CONTROL_TOKEN_KEY, minted)
    return minted
  }
}
