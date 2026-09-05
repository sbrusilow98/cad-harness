import { safeStorage } from 'electron'
import type { Cipher } from './secrets'

export function electronCipher(): Cipher {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  }
}
