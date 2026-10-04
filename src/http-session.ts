import { failure, InvalidArgumentError, isRecord, ok, parseHttpUrl, parsePublicKey } from "@innis/nostr-core"
import type { HttpUrl, PublicKey, Result, Signer } from "@innis/nostr-core"
import { signedAuthHeader } from "./auth-header.ts"

/** The default path a sign-in proof is signed for and posted to; the server names its own. */
export const SIGN_IN_PATH = "/action/sign-in"

/** The default path signing out posts to; it needs no proof, only the session cookie. */
export const SIGN_OUT_PATH = "/action/sign-out"

/**
 * Where the server mounted its session endpoints, when it is not the defaults.
 *
 * The server side (`innis/nostr-sign-in`) mounts its routes under a prefix of its own
 * choosing, so the client must be told the same paths — a NIP-98 proof pins the exact URL,
 * and one signed for the wrong path is refused.
 */
export interface SessionPaths {
  /** The sign-in path; {@linkcode SIGN_IN_PATH} when omitted. */
  readonly signIn?: string
  /** The sign-out path; {@linkcode SIGN_OUT_PATH} when omitted. */
  readonly signOut?: string
}

/**
 * Why a session request did not succeed.
 *
 * `refused` is the server saying no. `declined` is the person saying no at their signer, so
 * nothing was posted. The other three never got an answer: no proof was made because the
 * signer failed — the bunker never replied, the extension is gone — or the proof would be
 * longer than a server reads, the server could not be reached, or what came back was not
 * readable. The application words these for its own
 * audience; this module authors no user-facing copy.
 */
export type SessionFailureReason = "declined" | "not-signed" | "unreachable" | "unreadable" | "refused"

/**
 * The refusal, as something an application can word.
 *
 * `message` is the server's own words when it sent any — only a `refused` reason can carry
 * them — parsed from an untrusted response and empty-checked at this boundary.
 */
export interface SessionFailure {
  /** Which way the request failed. */
  readonly reason: SessionFailureReason
  /** The server's own words, or null when it sent none or was never readable. */
  readonly message: string | null
}

/**
 * What the server answered when it accepted the request.
 *
 * `pubkey` is who is signed in now, or null for nobody — after signing out, or when what
 * the server sent does not parse as a public key: the response is untrusted input, so it
 * is parsed at this boundary and carried as the domain type from here on.
 */
export interface SessionAnswer {
  /** Who is signed in now, or null for nobody. */
  readonly pubkey: PublicKey | null
  /** The server's own words, or null when it sent none. */
  readonly message: string | null
}

/**
 * The answer or the refusal, as the core `Result` every expected failure in this ecosystem
 * comes back as: `.value` is the {@linkcode SessionAnswer}, `.error` the
 * {@linkcode SessionFailure} with the reason for the application to word.
 */
export type SessionOutcome = Result<SessionAnswer, SessionFailure>

/**
 * The session as the server keeps it.
 *
 * Signing in is one signed proof and nothing after it: the server holds the answer, and
 * the browser stops talking to relays until something is published. The server side of
 * this contract is `innis/nostr-sign-in`.
 */
export interface Session {
  /** Sign one NIP-98 proof and present it; the server answers with who is signed in. */
  signIn(signer: Signer): Promise<SessionOutcome>
  /** End the session; the server forgets who was signed in. */
  signOut(): Promise<SessionOutcome>
}

const readMessage = (payload: Record<string, unknown>): string | null => {
  const value = payload.message

  return typeof value === "string" && value !== "" ? value : null
}

const post = async (url: string, headers: Record<string, string>): Promise<Response | null> => {
  try {
    return await fetch(url, { method: "POST", headers, credentials: "same-origin" })
  } catch {
    return null
  }
}

const send = async (url: string, headers: Record<string, string>): Promise<SessionOutcome> => {
  const response = await post(url, headers)

  if (response === null) return failure({ reason: "unreachable", message: null })

  const payload: unknown = await response.json().catch(() => undefined)

  if (!isRecord(payload)) return failure({ reason: "unreadable", message: null })

  const message = readMessage(payload)

  if (payload.success !== true) return failure({ reason: "refused", message })

  return ok({
    pubkey: typeof payload.pubkey === "string" ? parsePublicKey(payload.pubkey) : null,
    message,
  })
}

const endpointUrl = (origin: string, path: string): HttpUrl => {
  const url = parseHttpUrl(URL.parse(path, origin)?.href)
  if (url === null) {
    throw new InvalidArgumentError(`A session endpoint is an http or https URL, not ${path} at ${origin}`)
  }
  return url
}

/**
 * The session endpoints of `innis/nostr-sign-in`, spoken over `fetch`.
 *
 * The origin is the page's own (`location.origin`), and each endpoint's URL is composed
 * once from it: the sign-in proof pins exactly the URL the request is posted to, so the
 * proof and the request cannot name different endpoints. Signing in carries the proof in
 * an `Authorization` header and no body at all — the signed event pins the method and
 * hashes the body, so an empty one is the simplest thing that can be pinned.
 */
export class HttpSession implements Session {
  private readonly signInUrl: HttpUrl
  private readonly signOutUrl: HttpUrl

  /**
   * Speaks to `origin` — the page's own — at the default paths unless told where else. An origin that is not `http`
   * or `https` is misuse and throws `InvalidArgumentError`.
   */
  constructor(origin: string, paths: SessionPaths = {}) {
    this.signInUrl = endpointUrl(origin, paths.signIn ?? SIGN_IN_PATH)
    this.signOutUrl = endpointUrl(origin, paths.signOut ?? SIGN_OUT_PATH)
  }

  /**
   * Sign one NIP-98 proof and present it; the server answers with who is signed in.
   *
   * The proof is worth nothing at any other URL and the server will not take the same one
   * twice. When no proof could be signed — the person declined at their extension, the
   * bunker never answered — nothing is posted, and the refusal reads `not-signed`.
   */
  async signIn(signer: Signer): Promise<SessionOutcome> {
    const header = await signedAuthHeader(signer, { url: this.signInUrl, method: "POST" })

    if (!header.success) {
      return failure({ reason: header.error.type === "rejected" ? "declined" : "not-signed", message: null })
    }

    return await send(this.signInUrl, { Authorization: header.value })
  }

  /** End the session; the server forgets who was signed in. */
  async signOut(): Promise<SessionOutcome> {
    return await send(this.signOutUrl, {})
  }
}
