import { assert, assertEquals } from "@std/assert"
import {
  createLocalSigner,
  defaultLocalSignerTools,
  failure,
  generateSecretKey,
  KIND_NOSTR_CONNECT,
  now,
  ok,
} from "@innis/nostr-core"
import type { NostrEvent } from "@innis/nostr-core"
import { publicKeyFixture, relayUrlFixture } from "@innis/nostr-core/testing"
import type { Nip46PublishResult, Nip46Subscription, Nip46Transport } from "@innis/nostr-nip46"
import type { SignerDescriptor } from "../src/signer-descriptor.ts"
import type { SignerDeps, SignerSession } from "../src/signer-for.ts"
import { injectedExtension, newClientSecretKeyHex, signerFor, waitForExtension } from "../src/signer-for.ts"

const BUNKER = "82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2"

/** Never reached: these tests build signers, they do not talk to anything. */
const silentTransport: Nip46Transport = {
  subscribe: (): Nip46Subscription => ({ abort: () => {} }),
  publish: (): Promise<Nip46PublishResult> => Promise.resolve({ ok: true }),
}

/** Every relay refuses: a request reaches nobody. */
const refusingTransport: Nip46Transport = {
  subscribe: (): Nip46Subscription => ({ abort: () => {} }),
  publish: (): Promise<Nip46PublishResult> => Promise.resolve({ ok: false }),
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
    userPubkey: () => publicKeyFixture("f".repeat(64)),
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

const CURVE_ORDER_HEX = "fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"

const descriptorWithClientKey = (clientSecretKeyHex: string): SignerDescriptor => ({
  kind: "bunker",
  bunkerUrl: `bunker://${BUNKER}?relay=wss://relay.example`,
  clientSecretKeyHex,
})

/** Storage is untrusted: a stored client key of zero is no secret key, so it reads as none rather than throwing. */
Deno.test("a descriptor whose client key is zero yields no signer", async () => {
  const session = await signerFor(descriptorWithClientKey("0".repeat(64)), { transport: silentTransport })

  assertEquals(session, null)
})

/** Storage is untrusted: a stored client key of n or above is never reduced mod n into some other key. */
Deno.test("a descriptor whose client key is the curve order yields no signer", async () => {
  const session = await signerFor(descriptorWithClientKey(CURVE_ORDER_HEX), { transport: silentTransport })

  assertEquals(session, null)
})

Deno.test("an extension signer needs nothing connected or released", async () => {
  setNostr(workingExtension)

  const session = await signerFor({ kind: "extension" }, { transport: silentTransport })
  assertEquals(await session?.connect(), ok(undefined))
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
  assertEquals(
    await session.signer.getPublicKey(),
    failure({ type: "no-signer", message: "No NIP-07 extension found" }),
  )
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

Deno.test("an extension signer has nothing to log out of", async () => {
  setNostr(workingExtension)

  const session = await signerFor({ kind: "extension" }, { transport: silentTransport })
  clearNostr()

  assertEquals(await session?.logout(), ok(undefined))
})

Deno.test("an extension signer talks over no relays", async () => {
  setNostr(workingExtension)

  const session = await signerFor({ kind: "extension" }, { transport: silentTransport })
  clearNostr()

  assertEquals(session?.getRelayUrls(), [])
})

Deno.test("a bunker signer talks over the relays its bunker url names until the bunker moves it", async () => {
  const session = await signerFor(bunkerDescriptor(), { transport: silentTransport })

  assertEquals(session?.getRelayUrls(), [relayUrlFixture("wss://relay.example")])
})

/** A restored session does not re-ask switch_relays, so it starts where the bunker last put it. */
Deno.test("a restored bunker session starts on the relays the descriptor remembers", async () => {
  const session = await signerFor(restoredBunkerDescriptor(["wss://moved.example"]), {
    transport: silentTransport,
    userPubkey: () => publicKeyFixture("f".repeat(64)),
  })

  assertEquals(session?.getRelayUrls(), [relayUrlFixture("wss://moved.example")])
})

/** Storage is untrusted: a remembered relay that no longer parses is dropped, not honoured. */
Deno.test("remembered relays that no longer parse fall back to the bunker url's", async () => {
  const session = await signerFor(restoredBunkerDescriptor(["not-a-relay"]), {
    transport: silentTransport,
    userPubkey: () => publicKeyFixture("f".repeat(64)),
  })

  assertEquals(session?.getRelayUrls(), [relayUrlFixture("wss://relay.example")])
})

const restoredBunkerDescriptor = (relays: ReadonlyArray<string>): SignerDescriptor => ({
  kind: "bunker",
  bunkerUrl: `bunker://${BUNKER}?relay=wss://relay.example`,
  clientSecretKeyHex: newClientSecretKeyHex(),
  relays,
})

/** NIP-46 makes logout a courtesy: the host deletes its key whatever the bunker says, so the answer is returned. */
Deno.test("a bunker logout that reaches no relay is reported, not thrown", async () => {
  const session = await signerFor(bunkerDescriptor(), {
    transport: refusingTransport,
    userPubkey: () => publicKeyFixture("f".repeat(64)),
  })
  assert(session !== null)
  await session.connect()

  assertEquals((await session.logout()).success, false)
})

/** NIP-46: the client deletes its key whether or not the bunker acknowledged, so a silent bunker must not hold logout up. */
Deno.test("a bunker that never answers logout is given up on after the wait", async () => {
  const session = await signerFor(bunkerDescriptor(), {
    transport: silentTransport,
    userPubkey: () => publicKeyFixture("f".repeat(64)),
  })
  assert(session !== null)
  await session.connect()

  const answer = await session.logout(10)

  assertEquals(answer.success ? null : answer.error.type, "disconnected")
})

Deno.test("a bunker pairing tells the bunker who is connecting", async () => {
  const bunkerSecretKey = generateSecretKey()
  const bunkerPubkey = defaultLocalSignerTools.getPublicKey(bunkerSecretKey)
  const published: NostrEvent[] = []
  const transport: Nip46Transport = {
    subscribe: (): Nip46Subscription => ({ abort: () => {} }),
    publish: (_relay, event): Promise<Nip46PublishResult> => {
      published.push(event)
      return Promise.resolve({ ok: true })
    },
  }
  const session = await signerFor(
    {
      kind: "bunker",
      bunkerUrl: `bunker://${bunkerPubkey}?relay=wss://relay.example&secret=pairing`,
      clientSecretKeyHex: newClientSecretKeyHex(),
    },
    { transport, clientMetadata: { name: "Example", url: "https://example.com", image: null } },
  )
  assert(session !== null)
  void session.connect()
  await new Promise((resolve) => setTimeout(resolve, 0))
  session.disconnect()

  const envelope = published[0]
  assert(envelope !== undefined)
  const conversationKey = defaultLocalSignerTools.getNip44ConversationKey(bunkerSecretKey, envelope.pubkey)
  const request = JSON.parse(defaultLocalSignerTools.nip44Decrypt(conversationKey, envelope.content))
  assertEquals(JSON.parse(request.params[3]), { name: "Example", url: "https://example.com" })
})

const AUTH_URL = "https://bunker.example/approve?request=1"

const PEER = publicKeyFixture("e".repeat(64))

interface BunkerReply {
  readonly result: string
  readonly error?: string
}

interface ScriptedBunker {
  readonly transport: Nip46Transport
  readonly descriptor: SignerDescriptor
  readonly answer: (reply: BunkerReply) => Promise<void>
}

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const scriptedBunker = (): ScriptedBunker => {
  const bunkerSecretKey = generateSecretKey()
  const requests: NostrEvent[] = []
  const deliveries: Array<(event: NostrEvent) => void> = []
  const transport: Nip46Transport = {
    subscribe: ({ onEvent }): Nip46Subscription => {
      deliveries.push(onEvent)
      return { abort: () => {} }
    },
    publish: (_relay, event): Promise<Nip46PublishResult> => {
      requests.push(event)
      return Promise.resolve({ ok: true })
    },
  }
  const answer = async (reply: BunkerReply): Promise<void> => {
    await nextTask()
    const request = requests.at(-1)
    assert(request !== undefined)
    const conversationKey = defaultLocalSignerTools.getNip44ConversationKey(bunkerSecretKey, request.pubkey)
    const { id } = JSON.parse(defaultLocalSignerTools.nip44Decrypt(conversationKey, request.content))
    const response = await createLocalSigner(bunkerSecretKey).signEvent({
      kind: KIND_NOSTR_CONNECT,
      created_at: now(),
      tags: [["p", request.pubkey]],
      content: defaultLocalSignerTools.nip44Encrypt(conversationKey, JSON.stringify({ id, ...reply })),
    })
    assert(response.success)
    for (const deliver of deliveries) deliver(response.value)
    await nextTask()
  }
  return {
    transport,
    descriptor: {
      kind: "bunker",
      bunkerUrl: `bunker://${defaultLocalSignerTools.getPublicKey(bunkerSecretKey)}?relay=wss://relay.example`,
      clientSecretKeyHex: newClientSecretKeyHex(),
    },
    answer,
  }
}

const connectedTo = async (bunker: ScriptedBunker, deps: Partial<SignerDeps> = {}): Promise<SignerSession> => {
  const session = await signerFor(bunker.descriptor, {
    transport: bunker.transport,
    userPubkey: () => publicKeyFixture("f".repeat(64)),
    ...deps,
  })
  assert(session !== null)
  await session.connect()
  return session
}

Deno.test("a bunker's auth challenge hands its url to the listener", async () => {
  const bunker = scriptedBunker()
  const handedOver: string[] = []
  const session = await connectedTo(bunker, { onAuthChallenge: (url) => handedOver.push(url) })
  const encrypting = session.signer.nip44Encrypt(PEER, "hi")

  await bunker.answer({ result: "auth_url", error: AUTH_URL })
  session.disconnect()
  await encrypting

  assertEquals(handedOver, [AUTH_URL])
})

Deno.test("a request a bunker challenged waits for the bunker's answer when a listener is given", async () => {
  const bunker = scriptedBunker()
  const session = await connectedTo(bunker, { onAuthChallenge: () => {} })
  const encrypting = session.signer.nip44Encrypt(PEER, "hi")

  await bunker.answer({ result: "auth_url", error: AUTH_URL })
  await bunker.answer({ result: "ciphertext" })

  assertEquals(await encrypting, ok("ciphertext"))
})

Deno.test("a request a bunker challenged fails at once, naming the url, when no listener is given", async () => {
  const bunker = scriptedBunker()
  const session = await connectedTo(bunker)
  const encrypting = session.signer.nip44Encrypt(PEER, "hi")

  await bunker.answer({ result: "auth_url", error: AUTH_URL })

  assertEquals(
    await encrypting,
    failure({ type: "encrypt-failed", message: `bunker requires authentication: ${AUTH_URL}` }),
  )
})

const withNostr = async (value: unknown, run: () => void): Promise<void> => {
  setNostr(value)
  try {
    run()
  } finally {
    clearNostr()
  }
}
