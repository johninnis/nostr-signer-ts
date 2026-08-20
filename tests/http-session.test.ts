import { assert, assertEquals } from "@std/assert"
import { createLocalSigner, generateSecretKey } from "@innis/nostr-core"
import type { Signer } from "@innis/nostr-core"
import { HttpSession, SIGN_IN_PATH, SIGN_OUT_PATH } from "../src/http-session.ts"

const ORIGIN = "https://example.test"

interface Sent {
  readonly path: string
  readonly authorization: string | null
}

const authorizationOf = (headers: unknown): string | null => {
  if (typeof headers !== "object" || headers === null) return null

  const value: unknown = Reflect.get(headers, "Authorization")

  return typeof value === "string" ? value : null
}

const withFetch = async (
  answer: (path: string) => Response | Promise<Response>,
  run: (sent: Array<Sent>) => Promise<void>,
): Promise<void> => {
  const original = globalThis.fetch
  const sent: Array<Sent> = []

  globalThis.fetch = (input: URL | Request | string, init?: RequestInit): Promise<Response> => {
    const path = String(input)
    sent.push({ path, authorization: authorizationOf(init?.headers) })

    return Promise.resolve(answer(path))
  }

  try {
    await run(sent)
  } finally {
    globalThis.fetch = original
  }
}

const json = (payload: unknown): Response => new Response(JSON.stringify(payload))

const localSigner = (): Signer => createLocalSigner(generateSecretKey())

const pinnedUrlOf = (header: string): string => {
  const parsed: unknown = JSON.parse(atob(header.slice("Nostr ".length)))
  assert(typeof parsed === "object" && parsed !== null)
  const tags: unknown = Reflect.get(parsed, "tags")
  assert(Array.isArray(tags))
  const urlTag: unknown = tags.find((tag) => Array.isArray(tag) && tag[0] === "u")
  assert(Array.isArray(urlTag))
  assert(typeof urlTag[1] === "string")

  return urlTag[1]
}

Deno.test("signing in signs a proof and presents it to the sign-in url", async () => {
  const signer = localSigner()
  const pubkey = await signer.getPublicKey()

  await withFetch(() => json({ success: true, pubkey }), async (sent) => {
    const outcome = await new HttpSession(ORIGIN).signIn(signer)

    assertEquals(sent[0]?.path, `${ORIGIN}${SIGN_IN_PATH}`)
    assert(sent[0]?.authorization?.startsWith("Nostr "))
    assertEquals(outcome, { success: true, value: { pubkey, message: null } })
  })
})

/** The proof and the request cannot name different endpoints: one object composes both. */
Deno.test("the proof pins exactly the url it is posted to", async () => {
  await withFetch(() => json({ success: true }), async (sent) => {
    await new HttpSession(ORIGIN, { signIn: "/auth/sign-in" }).signIn(localSigner())

    const header = sent[0]?.authorization
    assert(header !== null && header !== undefined)
    assertEquals(sent[0]?.path, `${ORIGIN}/auth/sign-in`)
    assertEquals(pinnedUrlOf(header), sent[0]?.path)
  })
})

Deno.test("a signer that cannot sign posts nothing and reads as not signed", async () => {
  const refusing: Signer = {
    ...localSigner(),
    signEvent: () => Promise.reject(new Error("declined at the extension")),
  }

  await withFetch(() => json({ success: true }), async (sent) => {
    const outcome = await new HttpSession(ORIGIN).signIn(refusing)

    assertEquals(sent.length, 0)
    assertEquals(outcome, { success: false, error: { reason: "not-signed", message: null } })
  })
})

Deno.test("a server answering something that is not a public key reads as nobody", async () => {
  await withFetch(() => json({ success: true, pubkey: "not-a-key" }), async () => {
    const outcome = await new HttpSession(ORIGIN).signIn(localSigner())

    assert(outcome.success)
    assertEquals(outcome.value.pubkey, null)
  })
})

Deno.test("a refusal carries the server's words", async () => {
  await withFetch(() => json({ success: false, message: "Not this time" }), async () => {
    const outcome = await new HttpSession(ORIGIN).signIn(localSigner())

    assertEquals(outcome, { success: false, error: { reason: "refused", message: "Not this time" } })
  })
})

Deno.test("signing out posts to the sign-out path with no proof", async () => {
  await withFetch(() => json({ success: true, pubkey: null }), async (sent) => {
    const outcome = await new HttpSession(ORIGIN).signOut()

    assertEquals(sent[0]?.path, `${ORIGIN}${SIGN_OUT_PATH}`)
    assertEquals(sent[0]?.authorization, null)
    assertEquals(outcome, { success: true, value: { pubkey: null, message: null } })
  })
})

Deno.test("a server answering json that is not an answer reads as unreadable", async () => {
  await withFetch(() => new Response("[1,2,3]"), async () => {
    const outcome = await new HttpSession(ORIGIN).signOut()

    assertEquals(outcome, { success: false, error: { reason: "unreadable", message: null } })
  })
})

/** A gateway answering an error page reached the browser fine; the answer is what is wrong. */
Deno.test("a server answering something that is not json reads as unreadable, not unreachable", async () => {
  await withFetch(() => new Response("<html>502 Bad Gateway</html>"), async () => {
    const outcome = await new HttpSession(ORIGIN).signOut()

    assertEquals(outcome, { success: false, error: { reason: "unreadable", message: null } })
  })
})

Deno.test("an unreachable server reads as a failure, not a fault", async () => {
  await withFetch(() => Promise.reject(new Error("offline")), async () => {
    const outcome = await new HttpSession(ORIGIN).signOut()

    assertEquals(outcome, { success: false, error: { reason: "unreachable", message: null } })
  })
})

Deno.test("a server that mounted its endpoints elsewhere is spoken to there", async () => {
  await withFetch(() => json({ success: true }), async (sent) => {
    const session = new HttpSession(ORIGIN, { signIn: "/auth/sign-in", signOut: "/auth/sign-out" })
    await session.signIn(localSigner())
    await session.signOut()

    assertEquals(sent[0]?.path, `${ORIGIN}/auth/sign-in`)
    assertEquals(sent[1]?.path, `${ORIGIN}/auth/sign-out`)
  })
})
