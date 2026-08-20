import { assertEquals } from "@std/assert"
import { isSignerDescriptor } from "../src/signer-descriptor.ts"

Deno.test("an extension descriptor is one", () => {
  assertEquals(isSignerDescriptor({ kind: "extension" }), true)
})

Deno.test("a complete bunker descriptor is one", () => {
  assertEquals(
    isSignerDescriptor({
      kind: "bunker",
      bunkerUrl: "bunker://abc?relay=wss://relay.example",
      clientSecretKeyHex: "a".repeat(64),
    }),
    true,
  )
})

/** Storage is shared with everything else on the origin, and with older versions. */
Deno.test("a bunker descriptor missing its credential is not one", () => {
  assertEquals(isSignerDescriptor({ kind: "bunker" }), false)
})

Deno.test("an unknown kind is not a descriptor", () => {
  assertEquals(isSignerDescriptor({ kind: "carrier-pigeon" }), false)
})

Deno.test("a non-object is not a descriptor", () => {
  assertEquals(isSignerDescriptor("extension"), false)
  assertEquals(isSignerDescriptor(null), false)
})
