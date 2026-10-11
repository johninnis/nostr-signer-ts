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

Deno.test("a bunker descriptor carrying the relays it was moved to is one", () => {
  assertEquals(
    isSignerDescriptor({
      kind: "bunker",
      bunkerUrl: "bunker://abc?relay=wss://relay.example",
      clientSecretKeyHex: "a".repeat(64),
      relays: ["wss://moved.example"],
    }),
    true,
  )
})

Deno.test("a bunker descriptor whose relays are not a list is not one", () => {
  assertEquals(
    isSignerDescriptor({
      kind: "bunker",
      bunkerUrl: "bunker://abc?relay=wss://relay.example",
      clientSecretKeyHex: "a".repeat(64),
      relays: "wss://moved.example",
    }),
    false,
  )
})

const bunkerDescriptorVerifiedAs = (userPubkey: unknown): unknown => ({
  kind: "bunker",
  bunkerUrl: "bunker://abc?relay=wss://relay.example",
  clientSecretKeyHex: "a".repeat(64),
  userPubkey,
})

Deno.test("a bunker descriptor stating the user pubkey it was verified as is one", () => {
  assertEquals(isSignerDescriptor(bunkerDescriptorVerifiedAs("f".repeat(64))), true)
})

/** Storage is untrusted: a stated pubkey that is not one would resume the session as nobody. */
Deno.test("a bunker descriptor whose user pubkey is not a pubkey is not one", () => {
  assertEquals(isSignerDescriptor(bunkerDescriptorVerifiedAs("not-a-pubkey")), false)
})

/** A pubkey is 64 lowercase hex characters, exactly as `parsePublicKey` reads one; upper case is not that form. */
Deno.test("a bunker descriptor whose user pubkey is upper-case hex is not one", () => {
  assertEquals(isSignerDescriptor(bunkerDescriptorVerifiedAs("F".repeat(64))), false)
})

Deno.test("a bunker descriptor whose user pubkey is not a string is not one", () => {
  assertEquals(isSignerDescriptor(bunkerDescriptorVerifiedAs(42)), false)
})

Deno.test("an unknown kind is not a descriptor", () => {
  assertEquals(isSignerDescriptor({ kind: "carrier-pigeon" }), false)
})

Deno.test("a non-object is not a descriptor", () => {
  assertEquals(isSignerDescriptor("extension"), false)
  assertEquals(isSignerDescriptor(null), false)
})
