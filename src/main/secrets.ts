import { existsSync, readFileSync } from 'node:fs'
import { writeFileAtomic } from './fs-utils'

export interface Cipher {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

const UNAVAILABLE = 'Secure storage is not available on this system, so API keys cannot be saved.'

export class SecretStore {
  private cache: Record<string, string> | null = null

  constructor(
    private readonly filePath: string,
    private readonly cipher: Cipher
  ) {}

  private read(): Record<string, string> {
    if (this.cache) return this.cache
    let map: Record<string, string> = {}
    if (existsSync(this.filePath) && this.cipher.isAvailable()) {
      try {
        const parsed: unknown = JSON.parse(this.cipher.decrypt(readFileSync(this.filePath)))
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') map[k] = v
        }
      } catch {
        map = {}
      }
    }
    this.cache = map
    return map
  }

  private write(map: Record<string, string>): void {
    if (!this.cipher.isAvailable()) throw new Error(UNAVAILABLE)
    writeFileAtomic(this.filePath, this.cipher.encrypt(JSON.stringify(map)))
    this.cache = map
  }

  get(name: string): string | null {
    return this.read()[name] ?? null
  }

  has(name: string): boolean {
    return this.get(name) !== null
  }

  set(name: string, value: string): void {
    this.write({ ...this.read(), [name]: value })
  }

  clear(name: string): void {
    const map = { ...this.read() }
    delete map[name]
    this.write(map)
  }
}
