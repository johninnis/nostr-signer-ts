import { buildNip98AuthEvent, encodeAuthHeader } from "@innis/nostr-core"
import type { Signer } from "@innis/nostr-core"

/** The request a NIP-98 proof pins: its URL, its method, and its body when it has one. */
export interface AuthHeaderRequest {
  /** The absolute URL the event's `u` tag names; the proof is worth nothing anywhere else. */
  readonly url: string
  /** The HTTP method the event's `method` tag pins. */
  readonly method: string
  /** The request body, hashed into a `payload` tag; omit it (or pass empty) for a bodyless request. */
  readonly body?: string
}

/**
 * A NIP-98 `Authorization` header for one request, signed by the given signer.
 *
 * The event pins the URL and the method (and hashes the body when there is one), so what it
 * proves is exactly "whoever holds this key is making this request, now". It is worth
 * nothing at any other URL, and a server with a replay guard will not take the same one
 * twice — which is why a fresh one is built per request.
 *
 * `signEvent` throws — on a refusal at the extension, on a bunker that never answers, on a
 * malformed reply. All of those mean the same thing to the caller, so they come back as
 * null. This is the layer where that conversion belongs: above it there is an answer, not
 * an exception.
 */
export const signedAuthHeader = async (signer: Signer, request: AuthHeaderRequest): Promise<string | null> => {
  try {
    const unsigned = await buildNip98AuthEvent({
      url: request.url,
      method: request.method,
      body: request.body,
    })

    return encodeAuthHeader(await signer.signEvent(unsigned))
  } catch {
    return null
  }
}
