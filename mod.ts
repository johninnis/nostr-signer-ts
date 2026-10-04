/**
 * Browser-side signer acquisition for Nostr web applications.
 *
 * One {@linkcode SignerDescriptor} names where a key lives — a NIP-07 extension or a NIP-46
 * bunker — and everything needed to reach it again. {@linkcode signerFor} turns a descriptor
 * into a `Signer` (the canonical contract from `@innis/nostr-core`), the same call whether
 * the pairing is minutes or months old. {@linkcode LocalStorageSigners} remembers the
 * descriptor between visits under a key the application chooses.
 * {@linkcode RelayPoolTransport} is the `Nip46Transport` a bunker conversation runs over,
 * and {@linkcode signedAuthHeader} turns the signer into a NIP-98 `Authorization` header for
 * one request — the shape per-request APIs such as `@innis/nostr-relay-management` consume.
 *
 * Applications that keep a server-side cookie session sign one such header for a sign-in
 * endpoint instead of one per request; the client half of that lives in
 * `@innis/nostr-signer/session` and the server half in the `innis/nostr-sign-in` composer
 * package.
 *
 * @example
 * ```ts
 * import { parseHttpUrl } from "@innis/nostr-core"
 * import { LocalStorageSigners, RelayPoolTransport, signedAuthHeader, signerFor } from "@innis/nostr-signer"
 *
 * const endpoint = parseHttpUrl("https://relay.example/rpc")
 * const signers = new LocalStorageSigners("myapp.signer")
 * const descriptor = signers.read() ?? { kind: "extension" }
 * const transport = new RelayPoolTransport()
 *
 * const session = await signerFor(descriptor, { transport })
 * if (endpoint !== null && session !== null && (await session.connect()).success) {
 *   const header = await signedAuthHeader(session.signer, { url: endpoint, method: "POST" })
 *   if (!header.success && header.error.type === "rejected") console.log("the person declined to sign")
 *   session.disconnect()
 *   transport.dispose()
 * }
 * ```
 *
 * @module
 */

export * from "./src/signer-descriptor.ts"
export * from "./src/signers.ts"
export * from "./src/signer-for.ts"
export * from "./src/relay-pool-transport.ts"
export * from "./src/auth-header.ts"
