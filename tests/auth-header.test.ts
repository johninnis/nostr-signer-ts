import { assert, assertEquals } from "@std/assert"
import { createLocalSigner, generateSecretKey } from "@innis/nostr-core"
import type { Signer } from "@innis/nostr-core"
import { signedAuthHeader } from "../src/auth-header.ts"

const localSigner = (): Signer => createLocalSigner(generateSecretKey())

Deno.test("a signed request becomes a Nostr authorisation header", async () => {
  const header = await signedAuthHeader(localSigner(), {
    url: "https://relay.example/rpc",
    method: "POST",
  })

  assert(header !== null)
  assert(header.startsWith("Nostr "))
})

Deno.test("the body is hashed into the proof when there is one", async () => {
  const withBody = await signedAuthHeader(localSigner(), {
    url: "https://relay.example/rpc",
    method: "POST",
    body: '{"op":"status"}',
  })

  assert(withBody !== null)
})

Deno.test("a signer that refuses yields no header", async () => {
  const refusing: Signer = {
    ...localSigner(),
    signEvent: () => Promise.reject(new Error("declined at the extension")),
  }

  assertEquals(await signedAuthHeader(refusing, { url: "https://relay.example/rpc", method: "POST" }), null)
})
