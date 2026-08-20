import { assert, assertEquals, assertRejects } from "@std/assert"
import { parsePublicKey } from "@innis/nostr-core"
import type { Nip46PublishResult, Nip46Subscription, Nip46Transport } from "@innis/nostr-nip46"
import type { SignerDescriptor } from "../src/signer-descriptor.ts"
import { injectedExtension, newClientSecretKeyHex, signerFor, waitForExtension } from "../src/signer-for.ts"

const BUNKER = "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2"

/** Never reached: these tests build signers, they do not talk to anything. */
const silentTransport: Nip46Transport = {
  subscribe: (): Nip46Subscription => ({ abort: () => {} }),
  publish: (): Promise<Nip46PublishResult> => Promise.resolve({ ok: true }),
}

const workingExtension = {
  getPublicKey: (): Promise<string> => Promise.resolve("f".repeat(64)),
  signEvent: (): Promise<unknown> => Promise.resolve({}),
}

const setNostr = (value: unknown): void => {
  Reflect.defineProperty(globalThis, "nostr", { value, configurable: true, writable: true })
}

const clearNostr = (): void => {
  Reflect.deleteProperty(globalThis, "nostr")
}

const bunkerDescriptor = (): SignerDescriptor => ({
  kind: "bunker",
  bunkerUrl: `bunker://${BUNKER}?relay=wss://relay.example`,
  clientSecretKeyHex: newClientSecretKeyHex(),
})

Deno.test("an extension descriptor yields an extension signer", async () => {
  setNostr(workingExtension)

  const session = await signerFor({ kind: "extension" }, { transport: silentTransport })
  clearNostr()

  assertEquals(session?.signer.kind, "extension")
})

Deno.test("a bunker descriptor yields a bunker signer", async () => {
  const session = await signerFor(bunkerDescriptor(), { transport: silentTransport })

  assertEquals(session?.signer.kind, "bunker")
})

/**
 * The point of the one factory: pairing for the first time and picking the same bunker up
 * months later are this call with this descriptor, and only what userPubkey answers differs.
 */
Deno.test("a known pubkey still yields a signer, so restoring is the same call", async () => {
  const session = await signerFor(bunkerDescriptor(), {
    transport: silentTransport,
    userPubkey: () => parsePublicKey("f".repeat(64)),
  })

  assert(session !== null)
})

Deno.test("no extension installed yields no signer", async () => {
  clearNostr()

  assertEquals(await signerFor({ kind: "extension" }, { transport: silentTransport }), null)
})

Deno.test("a descriptor naming something that is not a bunker url yields no signer", async () => {
  const session = await signerFor(
    { kind: "bunker", bunkerUrl: "https://example.com", clientSecretKeyHex: newClientSecretKeyHex() },
    { transport: silentTransport },
  )

  assertEquals(session, null)
})

Deno.test("a descriptor with a malformed client key yields no signer", async () => {
  const session = await signerFor(
    { kind: "bunker", bunkerUrl: `bunker://${BUNKER}?relay=wss://relay.example`, clientSecretKeyHex: "short" },
    { transport: silentTransport },
  )

  assertEquals(session, null)
})

Deno.test("an extension signer needs nothing connected or released", async () => {
  setNostr(workingExtension)

  const session = await signerFor({ kind: "extension" }, { transport: silentTransport })
  await session?.connect()
  session?.disconnect()
  clearNostr()

  assert(session !== null)
})

/** window.nostr is read fresh on every operation, never captured at acquisition. */
Deno.test("an extension that goes away mid-session is noticed", async () => {
  setNostr(workingExtension)

  const session = await signerFor({ kind: "extension" }, { transport: silentTransport })
  clearNostr()

  assert(session !== null)
  await assertRejects(() => session.signer.getPublicKey())
})

Deno.test("a client key is thirty-two bytes of hex", () => {
  assertEquals(newClientSecretKeyHex().length, 64)
  assert(/^[0-9a-f]{64}$/.test(newClientSecretKeyHex()))
})

Deno.test("window.nostr is read through a guard", async () => {
  await withNostr({ getPublicKey: "not a function" }, () => {
    assertEquals(injectedExtension(), null)
  })
})

/**
 * The timing bug. A NIP-07 extension injects from a content script, sometimes after the
 * page has loaded, so asking once told daily users they had no extension.
 */
Deno.test("an extension that arrives late is still found", async () => {
  clearNostr()

  const pending = waitForExtension(3000)
  setTimeout(() => setNostr(workingExtension), 250)

  const found = await pending
  clearNostr()

  assert(found !== null)
})

Deno.test("waiting gives up when no extension arrives", async () => {
  clearNostr()

  assertEquals(await waitForExtension(300), null)
})

const withNostr = async (value: unknown, run: () => void): Promise<void> => {
  setNostr(value)
  try {
    run()
  } finally {
    clearNostr()
  }
}
