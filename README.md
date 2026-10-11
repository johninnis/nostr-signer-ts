# @innis/nostr-signer

[![CI](https://github.com/johninnis/nostr-signer-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/johninnis/nostr-signer-ts/actions/workflows/ci.yml)

Browser-side signer acquisition for Nostr web applications: one `SignerDescriptor` names where the key lives — a NIP-07 extension or a NIP-46 bunker — and everything needed to reach it again; `signerFor` turns the descriptor into a `Signer` (the canonical contract from [`@innis/nostr-core`](https://jsr.io/@innis/nostr-core)), the same call whether the pairing is minutes or months old.

## Install

```bash
deno add jsr:@innis/nostr-signer
```

## Quick start

```ts
import { parseHttpUrl } from "@innis/nostr-core"
import { LocalStorageSigners, RelayPoolTransport, signedAuthHeader, signerFor } from "@innis/nostr-signer"

const endpoint = parseHttpUrl("https://relay.example/rpc")
const signers = new LocalStorageSigners("myapp.signer")
const descriptor = signers.read() ?? { kind: "extension" }
const transport = new RelayPoolTransport()

const session = await signerFor(descriptor, { transport })
if (endpoint !== null && session !== null && (await session.connect()).success) {
  const userPubkey = session.getUserPubkey()
  if (descriptor.kind === "bunker" && userPubkey !== null) {
    signers.write({ ...descriptor, relays: session.getRelayUrls(), userPubkey })
  }
  const header = await signedAuthHeader(session.signer, { url: endpoint, method: "POST" })
  if (header.success) {
    // …send the request with `Authorization: ${header.value}`…
  }
  session.disconnect()
  transport.dispose()
}
```

## What it provides

- **`SignerDescriptor`** — `{ kind: "extension" }` or `{ kind: "bunker", bunkerUrl, clientSecretKeyHex, relays?, userPubkey? }`, JSON all the way down. After a bunker's `connect`, write two things back into the stored descriptor, as the quick start does. `userPubkey`, from `session.getUserPubkey()`, is the identity the pairing was verified as, and it is what makes the next visit a restore: a descriptor that states it resumes as that identity, with no handshake and without the bunker URL's pairing secret, which the first `connect` spent; a descriptor without it pairs with that secret. Leave it out only while a pairing has not yet connected. `relays`, from `session.getRelayUrls()`, is the set the bunker moved the client to — a restored session starts there, since it does not ask again. The kinds are the `Signer.kind` discriminants from `@innis/nostr-core`, so a descriptor and the signer it produces speak the same vocabulary. `isSignerDescriptor` guards anything read from storage, and refuses a bunker descriptor whose `userPubkey` is not a `PublicKey` as `parsePublicKey` reads one (64 lowercase hex characters).
- **`signerFor(descriptor, deps)`** — the one way to get a signer. Waits briefly for a NIP-07 extension that has not injected itself yet; builds a NIP-46 client signer over the injected transport for a bunker. Null when the descriptor cannot produce a signer at all — no extension, or a stored bunker URL or client key that is not one, the key read with `@innis/nostr-core`'s `parseSecretKey` (64 lowercase hex characters of a secp256k1 scalar from 1 to n − 1) — an answer, not a fault. The `SignerSession` it returns carries the `signer`, `connect`, `disconnect`, `logout` (NIP-46 `logout` for a bunker, given up on as a `disconnected` failure after `timeoutMs`, five seconds by default; `ok` for an extension; delete the stored client key whatever it returns), `getRelayUrls` (the relays a bunker moved the client to during `connect` — store them back into the descriptor, since a restored session does not ask again; none for an extension) and `getUserPubkey` (the pubkey a bunker session is verified as — the descriptor's, or for a new pairing the one the bunker gives during `connect`, null until then — to store back into the descriptor as `userPubkey`; null for an extension). `deps.expectedExtensionPubkey` is an extension's identity check, and nothing else: the pubkey the application has signed in, read fresh each time. While it answers, every event the extension signs is checked against it, so a switch of account inside the extension is refused as `pubkey-mismatch` and reported to `deps.onPubkeyMismatch`; while it answers null, or is absent, the signer checks against the first identity the extension gives it. A bunker signer never reads it — whether a bunker session resumes, and as whom, is the descriptor's `userPubkey`. `deps.clientMetadata` (`{ name, url, image }`) is sent with a bunker pairing so the bunker can label the connection. `deps.onAuthChallenge(url)` is told the page a bunker asks the person to authorise a request in (NIP-46 `auth_url`) — only a web URL, exactly as the bunker sent it — so the application can offer it to them; the request keeps waiting for the bunker's real answer, which comes once they have authorised. Without it such a request fails at once, in the method's own failure mode, with the message `bunker requires authentication: <url>`. Whichever kind it is, the signer keeps `@innis/nostr-core`'s `Signer` contract: every outcome is a returned `SignerFailure`, and a template that is not a NIP-01 event is refused by `buildUnsignedEvent` before the extension or bunker is asked, so `signEvent` rejects with `InvalidArgumentError`.
- **`LocalStorageSigners(key)`** — remembers the descriptor between visits, under a key the application chooses, tolerating unavailable storage and garbage left by older versions.
- **`RelayPoolTransport`** — the `Nip46Transport` a bunker conversation runs over, built on [`@innis/nostr-relay-pool`](https://jsr.io/@innis/nostr-relay-pool). Subscriptions are live, through `subscribeManyLive` (a NIP-46 reply is never in a relay's backlog) and every socket closes on `dispose`.
- **`signedAuthHeader(signer, { url, method, body? })`** — a fresh NIP-98 `Authorization` header for one request to `url`, an `HttpUrl` from `@innis/nostr-core`, the shape per-request APIs such as [`@innis/nostr-relay-management`](https://jsr.io/@innis/nostr-relay-management) consume, as a `Result<string, AuthHeaderFailure>`: when the signer does not sign, its `SignerFailure` comes back unchanged, so a decline (`rejected`) is told apart from a signer that failed; a proof longer than the 4096 characters a server reads is `header-too-long`, and is not sent.

## `@innis/nostr-signer/session`

The client half of a cookie-session sign-in, for applications whose server holds the session: `HttpSession` signs exactly one NIP-98 proof for the sign-in endpoint, presents it, and signs out again — the proof pins exactly the URL it is posted to, because one object composes both, once, when it is made (an origin that is not `http` or `https` throws `InvalidArgumentError` there). The outcome is `@innis/nostr-core`'s `Result`: the answer, or a refusal carrying a `SessionFailureReason` for the application to word in its own voice — `declined` when the person refused to sign the proof, `not-signed` when the signer failed to. The server half of the contract is the `innis/nostr-sign-in` composer package. Applications that authenticate per request need none of this module.

```ts
import { HttpSession } from "@innis/nostr-signer/session"

const outcome = await new HttpSession(location.origin).signIn(session.signer)
console.log(outcome.success ? outcome.value.pubkey : outcome.error.reason)
```

## Development

```sh
deno task ci    # fmt:check, lint, check, coverage, exports-tested, docs
```
