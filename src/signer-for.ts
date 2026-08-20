import { defaultLocalSignerTools, formatHex, generateSecretKey, hexRegex, parseHex } from "@innis/nostr-core"
import type { LocalSignerTools, PublicKey, Signer } from "@innis/nostr-core"
import { createNip07Signer, isNostrExtension } from "@innis/nostr-nip07"
import type { NostrExtension } from "@innis/nostr-nip07"
import { createNip46ClientSigner, parseBunkerUrl } from "@innis/nostr-nip46"
import type { Nip46Transport } from "@innis/nostr-nip46"
import type { SignerDescriptor } from "./signer-descriptor.ts"

/** How long to keep looking for an extension that has not injected itself yet. */
const EXTENSION_WAIT_MS = 3000

const EXTENSION_POLL_MS = 100

/**
 * A signer, and the two things that have to happen around using one.
 *
 * `connect` is what makes it usable — waiting for an extension to appear, or the NIP-46
 * handshake — and `disconnect` releases whatever that took. An extension needs nothing
 * released, so its disconnect does nothing; the shape is the same either way so no caller
 * has to know which it holds.
 */
export interface SignerSession {
  /** The signer itself, satisfying the canonical contract from `@innis/nostr-core`. */
  readonly signer: Signer
  /** Whatever makes the signer usable: nothing for an extension, the handshake for a bunker. */
  readonly connect: () => Promise<void>
  /** Releases whatever `connect` took; a no-op for an extension. */
  readonly disconnect: () => void
}

/** What building a signer needs from the application. */
export interface SignerDeps {
  /** The wire a bunker is reached over; unused by an extension signer. */
  readonly transport: Nip46Transport
  /**
   * The identity already established, when there is one — read fresh so a mid-session
   * change is caught. It lets a bunker skip the pairing handshake, and it is what a signed
   * event's pubkey is checked against.
   */
  readonly userPubkey?: () => PublicKey | null
  /** Told when the key that signed is not the key that signed in. */
  readonly onPubkeyMismatch?: (expected: PublicKey, actual: PublicKey) => void
  /** The cryptographic primitives the NIP-46 envelopes are built with. */
  readonly tools?: LocalSignerTools
}

/**
 * Whatever is on `window.nostr` right now, read through `isNostrExtension` rather than
 * trusted: it was put there by software the application did not ship, and something that
 * is not a signer should read as no extension rather than fail later inside one.
 */
export const injectedExtension = (): NostrExtension | null => {
  const candidate: unknown = Reflect.get(globalThis, "nostr")

  return isNostrExtension(candidate) ? candidate : null
}

/**
 * The same, waiting for one that has not arrived yet.
 *
 * A NIP-07 extension puts `window.nostr` there from a content script, and several do it
 * after the page has loaded. Asking once, as early as possible, is how someone who has used
 * the same extension for months gets told they have not got one. NIP-07 defines no
 * readiness signal, so this polls.
 */
export const waitForExtension = (timeoutMs: number = EXTENSION_WAIT_MS): Promise<NostrExtension | null> => {
  const immediate = injectedExtension()

  if (immediate !== null) return Promise.resolve(immediate)

  return new Promise((resolve) => {
    let waited = 0

    const timer = setInterval(() => {
      const found = injectedExtension()
      waited += EXTENSION_POLL_MS

      if (found === null && waited < timeoutMs) return

      clearInterval(timer)
      resolve(found)
    }, EXTENSION_POLL_MS)
  })
}

/** A fresh client key for a new bunker pairing, as hex. */
export const newClientSecretKeyHex = (): string => formatHex(generateSecretKey())

const CLIENT_SECRET_KEY_HEX = hexRegex(64)

const clientSecretKeyFrom = (hex: string): Uint8Array | null => CLIENT_SECRET_KEY_HEX.test(hex) ? parseHex(hex) : null

/**
 * The one way an application gets a signer.
 *
 * Pairing with a bunker for the first time and picking one up again months later are the
 * same call with the same descriptor — the first time it is built from what the person
 * pasted, afterwards it is read from storage. A `userPubkey` that answers is what lets the
 * second case skip the handshake, because the identity was established when the pairing was
 * made — and the one-shot pairing secret from the bunker URL belongs to that first
 * handshake, so it is offered only while no identity is known.
 *
 * Null when the descriptor cannot produce a signer at all: no extension is installed, or
 * the stored bunker URL or client key is not one. That is an answer, not a fault — a
 * browser without an extension is the ordinary case.
 */
export const signerFor = async (
  descriptor: SignerDescriptor,
  deps: SignerDeps,
): Promise<SignerSession | null> => {
  const knownPubkey = deps.userPubkey?.() ?? null

  if (descriptor.kind === "extension") {
    if (await waitForExtension() === null) return null

    return {
      signer: createNip07Signer({
        getExtension: injectedExtension,
        getUserPubkey: deps.userPubkey ?? (() => null),
        onPubkeyMismatch: deps.onPubkeyMismatch,
      }),
      connect: () => Promise.resolve(),
      disconnect: () => {},
    }
  }

  const bunker = parseBunkerUrl(descriptor.bunkerUrl)
  const clientSecretKey = clientSecretKeyFrom(descriptor.clientSecretKeyHex)

  if (bunker === null || clientSecretKey === null) return null

  const signer = createNip46ClientSigner({
    tools: deps.tools ?? defaultLocalSignerTools,
    transport: deps.transport,
    clientSecretKey,
    remoteSignerPubkey: bunker.remoteSignerPubkey,
    relayUrls: bunker.relays,
    secret: knownPubkey === null ? bunker.secret : null,
    initialUserPubkey: knownPubkey,
    onPubkeyMismatch: deps.onPubkeyMismatch,
  })

  return {
    signer,
    connect: () => signer.connect(),
    disconnect: () => signer.disconnect(),
  }
}
