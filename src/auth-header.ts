import { buildNip98AuthEvent, encodeAuthHeader, failure, ok } from "@innis/nostr-core"
import type { HttpUrl, Result, Signer, SignerFailure } from "@innis/nostr-core"

/** The request a NIP-98 proof pins: its URL, its method, and its body when it has one. */
export interface AuthHeaderRequest {
  /** The absolute URL the event's `u` tag names; the proof is worth nothing anywhere else. */
  readonly url: HttpUrl
  /** The HTTP method the event's `method` tag pins. */
  readonly method: string
  /** The request body, hashed into a `payload` tag; omit it (or pass empty) for a bodyless request. */
  readonly body?: string
}

/**
 * Why no NIP-98 header came back: the signer's own `SignerFailure`, or `header-too-long` when the signed proof would
 * be longer than the 4096 characters a server reads (a request URL too long to pin).
 */
export type AuthHeaderFailure = SignerFailure | { readonly type: "header-too-long"; readonly message: string }

/**
 * A NIP-98 `Authorization` header for one request, signed by the given signer.
 *
 * The event pins the URL and the method (and hashes the body when there is one), so what it
 * proves is exactly "whoever holds this key is making this request, now". It is worth
 * nothing at any other URL, and a server with a replay guard will not take the same one
 * twice — which is why a fresh one is built per request.
 *
 * When the signer does not sign, its `SignerFailure` comes back as it is, so a caller can tell
 * the person declining (`rejected`) from a bunker that never answered or a malformed reply. A proof too long for a
 * server to read is `header-too-long`, and is never sent.
 */
export const signedAuthHeader = async (
  signer: Signer,
  request: AuthHeaderRequest,
): Promise<Result<string, AuthHeaderFailure>> => {
  const signed = await signer.signEvent(buildNip98AuthEvent({
    url: request.url,
    method: request.method,
    body: request.body ?? "",
  }))

  if (!signed.success) return signed
  const header = encodeAuthHeader(signed.value)
  return header === null
    ? failure({ type: "header-too-long", message: `The proof for ${request.url} is longer than a server reads` })
    : ok(header)
}
