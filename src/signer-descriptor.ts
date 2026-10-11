import { isValidPublicKey } from "@innis/nostr-core"
import type { PublicKey } from "@innis/nostr-core"

/**
 * Where the key is, and everything needed to reach it again.
 *
 * One type for both, because everything above the signer treats them the same: an extension
 * and a bunker differ in where the key lives and in nothing an application does with it.
 * Pairing for the first time and picking the key up again months later are the same
 * {@linkcode signerFor} call with the same descriptor — the first time it is built from what
 * the person entered, afterwards it is read from storage.
 *
 * The `kind` values are the `Signer.kind` discriminants from `@innis/nostr-core`
 * (`"extension"` for NIP-07, `"bunker"` for NIP-46), so a descriptor and the signer it
 * produces speak the same vocabulary.
 *
 * The client secret key is this browser's own, generated per pairing, and never the
 * visitor's identity key. It signs the envelopes NIP-46 wraps requests in, so the bunker can
 * tell one client from another. It is still a credential — whoever holds it can ask that
 * bunker to sign as the visitor, within whatever the bunker allows — so it is discarded on
 * sign-out. It is carried as hex so a descriptor is JSON all the way down.
 *
 * `relays` is the set the bunker moved the client to with `switch_relays` at the last
 * `connect`, written back by the application afterwards. A restored session does not ask
 * again, so it starts where the bunker last put it — which matters once the bunker has
 * migrated off the relays its old URL names. Absent in descriptors written before the first
 * connect, or by older versions; the bunker URL's own relays are the fallback.
 *
 * `userPubkey` is the identity the bunker session was verified as by the `connect` that paired
 * it, written back by the application from the session's `getUserPubkey()`. It is what makes the
 * descriptor a restore: `signerFor` resumes the session as that identity, with no handshake
 * and without the bunker URL's pairing secret, which was spent when the pairing was made.
 * Absent in a pairing that has not yet connected, which pairs with that secret.
 */
export type SignerDescriptor =
  | { readonly kind: "extension" }
  | {
    readonly kind: "bunker"
    readonly bunkerUrl: string
    readonly clientSecretKeyHex: string
    readonly relays?: ReadonlyArray<string>
    readonly userPubkey?: PublicKey
  }

/**
 * Whether an unknown value is a {@linkcode SignerDescriptor}.
 *
 * Storage is shared with everything else on an origin and with older versions of the
 * application that wrote it, so anything read back goes through this guard: what is not a
 * descriptor should read as none rather than fail later inside a signer. A bunker
 * descriptor's `userPubkey`, when present, must be a `PublicKey` exactly as `parsePublicKey`
 * from `@innis/nostr-core` reads one — 64 lowercase hex characters — or the whole descriptor
 * reads as none.
 */
export const isSignerDescriptor = (value: unknown): value is SignerDescriptor => {
  if (typeof value !== "object" || value === null) return false

  const kind = Reflect.get(value, "kind")

  if (kind === "extension") return true

  return kind === "bunker" &&
    typeof Reflect.get(value, "bunkerUrl") === "string" &&
    typeof Reflect.get(value, "clientSecretKeyHex") === "string" &&
    (Reflect.get(value, "relays") === undefined || Array.isArray(Reflect.get(value, "relays"))) &&
    (Reflect.get(value, "userPubkey") === undefined || isValidPublicKey(Reflect.get(value, "userPubkey")))
}
