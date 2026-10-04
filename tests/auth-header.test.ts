import { assert, assertEquals } from "@std/assert"
import { createLocalSigner, failure, generateSecretKey } from "@innis/nostr-core"
import type { Signer } from "@innis/nostr-core"
import { httpUrlFixture } from "@innis/nostr-core/testing"
import { signedAuthHeader } from "../src/auth-header.ts"

const localSigner = (): Signer => createLocalSigner(generateSecretKey())

Deno.test("a signed request becomes a Nostr authorisation header", async () => {
  const header = await signedAuthHeader(localSigner(), {
    url: httpUrlFixture("https://relay.example/rpc"),
    method: "POST",
  })

  assert(header.success)
  assert(header.value.startsWith("Nostr "))
})

Deno.test("the body is hashed into the proof when there is one", async () => {
  const withBody = await signedAuthHeader(localSigner(), {
    url: httpUrlFixture("https://relay.example/rpc"),
    method: "POST",
    body: '{"op":"status"}',
  })

  assert(withBody.success)
})

Deno.test("a decline comes back as the signer's rejected failure, not folded into a missing header", async () => {
  const declined = { type: "rejected", message: "declined at the extension" } as const
  const refusing: Signer = { ...localSigner(), signEvent: () => Promise.resolve(failure(declined)) }

  assertEquals(
    await signedAuthHeader(refusing, { url: httpUrlFixture("https://relay.example/rpc"), method: "POST" }),
    failure(declined),
  )
})

Deno.test("a signer that fails comes back as its failure", async () => {
  const broken = { type: "disconnected", message: "bunker never answered" } as const
  const unreachable: Signer = { ...localSigner(), signEvent: () => Promise.resolve(failure(broken)) }

  assertEquals(
    await signedAuthHeader(unreachable, { url: httpUrlFixture("https://relay.example/rpc"), method: "POST" }),
    failure(broken),
  )
})

Deno.test("a proof longer than a server reads comes back as header-too-long, not as a header", async () => {
  const header = await signedAuthHeader(localSigner(), {
    url: httpUrlFixture(`https://relay.example/${"a".repeat(4096)}`),
    method: "POST",
  })

  assertEquals(header.success ? null : header.error.type, "header-too-long")
})
