/**
 * Walkthrough of the main features of @innis/nostr-signer.
 *
 * Run with: `deno run examples/walkthrough.ts` (no permissions required — `window.nostr` is a
 * stand-in backed by a local key and local storage is an in-memory map, so everything runs
 * locally). Each step asserts what it shows.
 *
 * @module
 */

import { assert, assertEquals } from "@std/assert"
import { createLocalSigner, generateSecretKey, parseAuthHeader, parseHttpUrl } from "@innis/nostr-core"
import type { Result, SignerFailure, UnsignedEvent } from "@innis/nostr-core"
import type { Nip46Transport } from "@innis/nostr-nip46"
import { LocalStorageSigners, newClientSecretKeyHex, signedAuthHeader, signerFor } from "../mod.ts"

const unwrap = async <T>(result: Promise<Result<T, SignerFailure>>): Promise<T> => {
  const settled = await result
  if (!settled.success) throw new Error(settled.error.message)
  return settled.value
}

const key = createLocalSigner(generateSecretKey())
const pubkey = await unwrap(key.getPublicKey())
Reflect.set(globalThis, "nostr", {
  getPublicKey: () => unwrap(key.getPublicKey()),
  signEvent: (event: UnsignedEvent) => unwrap(key.signEvent(event)),
})

const items = new Map<string, string>()
Reflect.set(globalThis, "localStorage", {
  getItem: (name: string) => items.get(name) ?? null,
  setItem: (name: string, value: string) => items.set(name, value),
  removeItem: (name: string) => items.delete(name),
})

const signers = new LocalStorageSigners("walkthrough.signer")
assertEquals(signers.read(), null)
signers.write({ kind: "extension" })
const descriptor = signers.read()
assertEquals(descriptor, { kind: "extension" })

const unusedWire: Nip46Transport = {
  subscribe: () => ({ abort: () => {} }),
  publish: () => Promise.resolve({ ok: false }),
}
const session = await signerFor(descriptor ?? { kind: "extension" }, { transport: unusedWire })
assert(session !== null)
assertEquals((await session.connect()).success, true)

const endpoint = parseHttpUrl("https://api.example/rpc")
assert(endpoint !== null)
const header = await signedAuthHeader(session.signer, { url: endpoint, method: "POST" })
assert(header.success)
const proof = parseAuthHeader(header.value)
assert(proof.success && proof.value.pubkey === pubkey)

const bunkerUrl = `bunker://${pubkey}?relay=wss://relay.example`
assertEquals(
  await signerFor({ kind: "bunker", bunkerUrl, clientSecretKeyHex: "not hex" }, { transport: unusedWire }),
  null,
)
assertEquals(newClientSecretKeyHex().length, 64)

signers.forget()
assertEquals(signers.read(), null)
session.disconnect()
