/**
 * The client half of a cookie-session sign-in.
 *
 * For applications whose server holds the session — the browser signs exactly one NIP-98
 * proof for the sign-in endpoint, and every later request is authenticated by the cookie.
 * {@linkcode HttpSession} signs that one proof, presents it, and signs out again, and
 * {@linkcode SessionOutcome} is the answer or the refusal, with a
 * {@linkcode SessionFailureReason} for the application to word — this module authors no
 * user-facing copy. The proof pins exactly the URL it is posted to, because one object
 * owns both. The server half of the contract is the `innis/nostr-sign-in` composer
 * package.
 *
 * Applications that authenticate per request — management APIs, relay RPC — need none of
 * this module; they build a header per request with `signedAuthHeader` from the main
 * export.
 *
 * @example
 * ```ts
 * import { signerFor } from "@innis/nostr-signer"
 * import { HttpSession } from "@innis/nostr-signer/session"
 *
 * const session = await signerFor(descriptor, { transport })
 * if (session !== null) {
 *   await session.connect()
 *   const outcome = await new HttpSession(location.origin).signIn(session.signer)
 *   console.log(outcome.success ? outcome.value.pubkey : outcome.error.reason)
 * }
 * ```
 *
 * @module
 */

export * from "./src/http-session.ts"
