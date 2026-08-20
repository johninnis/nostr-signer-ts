import type { SignerDescriptor } from "./signer-descriptor.ts"
import { isSignerDescriptor } from "./signer-descriptor.ts"

/**
 * How this browser signs, remembered between visits.
 *
 * A server session does not need it — a cookie says who is signed in and survives a reload
 * on its own. This is for the next time something has to be *signed*: publishing, weeks
 * later, without pairing again.
 */
export interface Signers {
  /** The remembered descriptor, or null when none is stored or what is stored is not one. */
  read(): SignerDescriptor | null
  /** Remember how this browser signs. */
  write(descriptor: SignerDescriptor): void
  /** Discard the descriptor — and with it the bunker client credential it may carry. */
  forget(): void
}

/**
 * The signer descriptor, in local storage under the application's own key.
 *
 * The key is the application's to choose (`"biblestr.signer"`, `"hubstr.signer"`, …) so two
 * applications on one origin cannot read each other's pairing. What is read back goes
 * through {@linkcode isSignerDescriptor}: it was written by an older version of the
 * application, or by something else on the same origin, and anything that is not a
 * descriptor reads as none rather than failing later inside a signer.
 *
 * Every method tolerates storage being unavailable. Private browsing and quota limits both
 * make it throw, and someone who cannot save how they sign should still be able to sign in —
 * they will be asked again next time.
 */
export class LocalStorageSigners implements Signers {
  /** Remembers under `key`, the application's own name for its pairing. */
  constructor(private readonly key: string) {}

  /** The remembered descriptor, or null when none is stored or what is stored is not one. */
  read(): SignerDescriptor | null {
    try {
      const stored = globalThis.localStorage.getItem(this.key)

      if (stored === null) return null

      const parsed: unknown = JSON.parse(stored)

      return isSignerDescriptor(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  /** Remember how this browser signs. */
  write(descriptor: SignerDescriptor): void {
    try {
      globalThis.localStorage.setItem(this.key, JSON.stringify(descriptor))
    } catch {
      return
    }
  }

  /** Discard the descriptor — and with it the bunker client credential it may carry. */
  forget(): void {
    try {
      globalThis.localStorage.removeItem(this.key)
    } catch {
      return
    }
  }
}
