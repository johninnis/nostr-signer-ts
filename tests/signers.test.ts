import { assertEquals } from "@std/assert"
import { LocalStorageSigners } from "../src/signers.ts"
import type { SignerDescriptor } from "../src/signer-descriptor.ts"

const KEY = "test.signer"

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

class FakeStorage implements StorageLike {
  private readonly items = new Map<string, string>()
  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }
  removeItem(key: string): void {
    this.items.delete(key)
  }
}

const withStorage = (storage: StorageLike, run: () => void): void => {
  const original = Reflect.get(globalThis, "localStorage")
  Reflect.defineProperty(globalThis, "localStorage", { value: storage, configurable: true })
  try {
    run()
  } finally {
    Reflect.defineProperty(globalThis, "localStorage", { value: original, configurable: true })
  }
}

const bunker: SignerDescriptor = {
  kind: "bunker",
  bunkerUrl: "bunker://abc?relay=wss://relay.example",
  clientSecretKeyHex: "a".repeat(64),
}

Deno.test("a bunker descriptor survives being written and read back", () => {
  withStorage(new FakeStorage(), () => {
    const signers = new LocalStorageSigners(KEY)
    signers.write(bunker)

    assertEquals(signers.read(), bunker)
  })
})

Deno.test("an extension descriptor survives too", () => {
  withStorage(new FakeStorage(), () => {
    const signers = new LocalStorageSigners(KEY)
    signers.write({ kind: "extension" })

    assertEquals(signers.read(), { kind: "extension" })
  })
})

Deno.test("nothing stored is no descriptor", () => {
  withStorage(new FakeStorage(), () => {
    assertEquals(new LocalStorageSigners(KEY).read(), null)
  })
})

/** Local storage is shared with everything else on this origin, and with older versions. */
Deno.test("a half-written bunker descriptor reads as none", () => {
  const storage = new FakeStorage()
  storage.setItem(KEY, '{"kind":"bunker"}')

  withStorage(storage, () => {
    assertEquals(new LocalStorageSigners(KEY).read(), null)
  })
})

Deno.test("unparseable storage reads as none", () => {
  const storage = new FakeStorage()
  storage.setItem(KEY, "not json")

  withStorage(storage, () => {
    assertEquals(new LocalStorageSigners(KEY).read(), null)
  })
})

/** Signing out discards it: it can ask that bunker to sign as the last person. */
Deno.test("forgetting removes it", () => {
  withStorage(new FakeStorage(), () => {
    const signers = new LocalStorageSigners(KEY)
    signers.write(bunker)
    signers.forget()

    assertEquals(signers.read(), null)
  })
})

/** Private browsing and quota limits both make storage throw; signing in still works. */
Deno.test("storage that throws is tolerated on every method", () => {
  const throwing = {
    getItem: (): string | null => {
      throw new DOMException("denied")
    },
    setItem: (): void => {
      throw new DOMException("quota")
    },
    removeItem: (): void => {
      throw new DOMException("denied")
    },
  }

  withStorage(throwing, () => {
    const signers = new LocalStorageSigners(KEY)
    signers.write(bunker)
    signers.forget()

    assertEquals(signers.read(), null)
  })
})

Deno.test("two applications on one origin keep separate descriptors", () => {
  withStorage(new FakeStorage(), () => {
    new LocalStorageSigners("one.signer").write(bunker)

    assertEquals(new LocalStorageSigners("two.signer").read(), null)
  })
})
