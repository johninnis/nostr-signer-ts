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
import type { NostrEvent, PublicKey } from "@innis/nostr-core"
import { publicKeyFixture } from "@innis/nostr-core/testing"
import type { Nip46PublishResult, Nip46Subscription, Nip46Transport } from "@innis/nostr-nip46"
import type { SignerDescriptor } from "../src/signer-descriptor.ts"
import type { SignerDeps, SignerSession } from "../src/signer-for.ts"
import { newClientSecretKeyHex, signerFor } from "../src/signer-for.ts"

type BunkerDescriptor = Extract<SignerDescriptor, { kind: "bunker" }>

const USER = publicKeyFixture("f".repeat(64))

const SIGNED_IN = publicKeyFixture("d".repeat(64))

const AUTH_URL = "https://bunker.example/approve?request=1"

const PEER = publicKeyFixture("e".repeat(64))

interface BunkerReply {
  readonly result: string
  readonly error?: string
}

interface SentRequest {
  readonly method: string
  readonly params: ReadonlyArray<string>
}

interface ScriptedBunker {
  readonly pubkey: PublicKey
  readonly transport: Nip46Transport
  /** A pairing that has not yet connected: the bunker URL carries its one-shot secret. */
  readonly pairing: BunkerDescriptor
  readonly answer: (reply: BunkerReply) => Promise<void>
  /** Every request the client has sent the bunker so far, decrypted. */
  readonly sent: () => ReadonlyArray<SentRequest>
}

const PAIRING_SECRET = "pairing-secret"

const nextTask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const scriptedBunker = (): ScriptedBunker => {
  const bunkerSecretKey = generateSecretKey()
  const bunkerPubkey = defaultLocalSignerTools.getPublicKey(bunkerSecretKey)
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
  const sent = (): ReadonlyArray<SentRequest> =>
    requests.map((request) => {
      const conversationKey = defaultLocalSignerTools.getNip44ConversationKey(bunkerSecretKey, request.pubkey)
      const { method, params } = JSON.parse(defaultLocalSignerTools.nip44Decrypt(conversationKey, request.content))
      return { method, params }
    })
  return {
    pubkey: bunkerPubkey,
    transport,
    pairing: {
      kind: "bunker",
      bunkerUrl: `bunker://${bunkerPubkey}?relay=wss://relay.example&secret=${PAIRING_SECRET}`,
      clientSecretKeyHex: newClientSecretKeyHex(),
    },
    answer,
    sent,
  }
}

const resumedFrom = (bunker: ScriptedBunker): BunkerDescriptor => ({ ...bunker.pairing, userPubkey: USER })

const connectedTo = async (bunker: ScriptedBunker, deps: Partial<SignerDeps> = {}): Promise<SignerSession> => {
  const session = await signerFor(resumedFrom(bunker), { transport: bunker.transport, ...deps })
  assert(session !== null)
  await session.connect()
  return session
}

/** Starts the handshake, lets its first request go out, then hangs up rather than wait for an answer. */
const startPairing = async (session: SignerSession): Promise<void> => {
  void session.connect()
  await nextTask()
  session.disconnect()
}

/** Shared ADR-0060: a resumed session subscribes and sends nothing; the host's first request is the first thing the bunker sees. */
Deno.test("a descriptor stating the user pubkey resumes, sending the bunker nothing on connect", async () => {
  const bunker = scriptedBunker()

  await connectedTo(bunker)

  assertEquals(bunker.sent(), [])
})

/** ADR-0003: the bunker URL's secret is one-shot and was spent pairing, so a resumed session never offers it. */
Deno.test("a resumed session that has to handshake again does not offer the pairing secret", async () => {
  const bunker = scriptedBunker()
  const session = await connectedTo(bunker)
  session.disconnect()

  await startPairing(session)

  assertEquals(bunker.sent(), [{ method: "connect", params: [bunker.pubkey] }])
})

Deno.test("a descriptor without the user pubkey pairs with the bunker url's secret", async () => {
  const bunker = scriptedBunker()
  const session = await signerFor(bunker.pairing, { transport: bunker.transport })
  assert(session !== null)

  await startPairing(session)

  assertEquals(bunker.sent(), [{ method: "connect", params: [bunker.pubkey, PAIRING_SECRET] }])
})

/** ADR-0003: whether a bunker session is a restore is the pairing's to say, never who the application has signed in. */
Deno.test("a bunker pairing ignores the extension's expected pubkey and pairs with the secret", async () => {
  const bunker = scriptedBunker()
  const session = await signerFor(bunker.pairing, { transport: bunker.transport, expectedExtensionPubkey: () => USER })
  assert(session !== null)

  await startPairing(session)

  assertEquals(bunker.sent(), [{ method: "connect", params: [bunker.pubkey, PAIRING_SECRET] }])
})

Deno.test("a resumed bunker session is verified as its descriptor's pubkey, not the extension's expected one", async () => {
  const session = await connectedTo(scriptedBunker(), { expectedExtensionPubkey: () => SIGNED_IN })

  assertEquals(session.getUserPubkey(), USER)
})

Deno.test("a new bunker pairing is verified as no one before it connects", async () => {
  const bunker = scriptedBunker()
  const session = await signerFor(bunker.pairing, { transport: bunker.transport })

  assertEquals(session?.getUserPubkey(), null)
})

/** What the application writes back into the descriptor, so the next visit resumes rather than pairs. */
Deno.test("a new bunker pairing is verified as the pubkey the bunker gives at connect", async () => {
  const bunker = scriptedBunker()
  const session = await signerFor(bunker.pairing, { transport: bunker.transport })
  assert(session !== null)
  const connecting = session.connect()

  await bunker.answer({ result: "ack" })
  await bunker.answer({ result: "null" })
  await bunker.answer({ result: USER })
  await connecting

  assertEquals(session.getUserPubkey(), USER)
})
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
