# @innis/nostr-signer

[![CI](https://github.com/johninnis/nostr-signer-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/johninnis/nostr-signer-ts/actions/workflows/ci.yml)

Browser-side signer acquisition for Nostr web applications: one `SignerDescriptor` names where
the key lives — a NIP-07 extension or a NIP-46 bunker — and everything needed to reach it
again; `signerFor` turns the descriptor into a `Signer` (the canonical contract from
[`@innis/nostr-core`](https://jsr.io/@innis/nostr-core)), the same call whether the pairing is
minutes or months old.

## Install

```bash
deno add jsr:@innis/nostr-signer
```

## Quick start

```ts
import { LocalStorageSigners, RelayPoolTransport, signedAuthHeader, signerFor } from "@innis/nostr-signer"

const signers = new LocalStorageSigners("myapp.signer")
const descriptor = signers.read() ?? { kind: "extension" }
const transport = new RelayPoolTransport()

const session = await signerFor(descriptor, { transport })
if (session !== null) {
  await session.connect()
  const header = await signedAuthHeader(session.signer, { url: "https://relay.example/rpc", method: "POST" })
  // …send the request with the Authorization header…
  session.disconnect()
  transport.dispose()
}
```

## What it provides

- **`SignerDescriptor`** — `{ kind: "extension" }` or
  `{ kind: "bunker", bunkerUrl, clientSecretKeyHex }`, JSON all the way down. The kinds are the
  `Signer.kind` discriminants from `@innis/nostr-core`, so a descriptor and the signer it
  produces speak the same vocabulary. `isSignerDescriptor` guards anything read from storage.
- **`signerFor(descriptor, deps)`** — the one way to get a signer. Waits briefly for a NIP-07
  extension that has not injected itself yet; builds a NIP-46 client signer over the injected
  transport for a bunker. Null when the descriptor cannot produce a signer at all — an answer,
  not a fault.
- **`LocalStorageSigners(key)`** — remembers the descriptor between visits, under a key the
  application chooses, tolerating unavailable storage and garbage left by older versions.
- **`RelayPoolTransport`** — the `Nip46Transport` a bunker conversation runs over, built on
  [`@innis/nostr-relay-pool`](https://jsr.io/@innis/nostr-relay-pool). Subscriptions are
  persistent (a NIP-46 reply is never in a relay's backlog) and every socket closes on
  `dispose`.
- **`signedAuthHeader(signer, { url, method, body? })`** — a fresh NIP-98 `Authorization`
  header for one request, the shape per-request APIs such as
  [`@innis/nostr-relay-management`](https://jsr.io/@innis/nostr-relay-management) consume.

## `@innis/nostr-signer/session`

The client half of a cookie-session sign-in, for applications whose server holds the session:
`HttpSession` signs exactly one NIP-98 proof for the sign-in endpoint, presents it, and signs
out again — the proof pins exactly the URL it is posted to, because one object composes both.
The outcome is `@innis/nostr-core`'s `Result`: the answer, or a refusal carrying a
`SessionFailureReason` for the application to word in its own voice. The server half of the
contract is the `innis/nostr-sign-in` composer package. Applications that authenticate per
request need none of this module.

```ts
import { HttpSession } from "@innis/nostr-signer/session"

const outcome = await new HttpSession(location.origin).signIn(session.signer)
console.log(outcome.success ? outcome.value.pubkey : outcome.error.reason)
```

## Development

```sh
deno task ci    # fmt:check, lint, check, coverage, exports-tested, docs
```
