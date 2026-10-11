# 0003. A bunker session resumes as the pubkey its descriptor states, and the expected pubkey checks only an extension

## Status

Accepted

## Context

`signerFor` needs two answers about identity, and it took both from one callback, `deps.userPubkey`:

- For a bunker, it decided whether the session was a restore. A pubkey meant the pairing had already connected: the session resumed as that identity with no handshake, and the bunker URL's pairing secret was withheld, because the secret is one-shot and was spent by the `connect` that paired it. Null meant a new pairing, which sends the secret.
- For an extension, it was the identity the NIP-07 signer checks every signed event against, read fresh so that a switch of account inside the extension is refused.

The two answers belong to different things. Whether a bunker pairing has connected is a fact about the pairing, which is what the descriptor stores, and it must be known the moment a stored descriptor is read, before anything has connected. Who the application expects an extension to sign as is a fact about the application's sign-in, which has its own lifetime: a server session can lapse while the pairing lives on, and a person can be signed in before a new pairing has connected. Fed the sign-in, the callback turns a new pairing into a "restore" that never sends its secret, and a restored pairing whose sign-in has lapsed into a pairing that sends a spent secret and is refused. So every application had to branch on the signer kind to work out what the callback should answer, and each would repeat the same branch.

## Decision

- The bunker descriptor carries an optional `userPubkey`: the identity the session was verified as by the `connect` that paired it. The application writes it back from the session's `getUserPubkey()` after `connect`, beside the relays it writes back from `getRelayUrls()` (ADR-0001).
- `signerFor` decides a restore from the descriptor alone. A descriptor that states `userPubkey` resumes as that identity, with no handshake and no pairing secret, and that pubkey is what every event the bunker signs is checked against. A descriptor without it pairs with the bunker URL's secret.
- The deps callback becomes `expectedExtensionPubkey`, the extension's identity check and nothing else. A bunker signer never reads it.
- `isSignerDescriptor` accepts `userPubkey` absent, and refuses the whole descriptor when it is present but is not a `PublicKey`: 64 lowercase hex characters, as `parsePublicKey` reads one. A remembered relay that does not parse can be dropped, because the bunker URL's relays are a sound fallback. A pubkey that does not parse has no sound reading: ignoring it would pair again with a spent secret, and honouring it would resume as something that is not an identity.

## Consequences

- No application branches on the signer kind to build `SignerDeps`. A restore travels with the pairing it belongs to, and the extension check stays with the sign-in.
- The rename makes the break visible: a caller still passing `userPubkey` among the deps of `signerFor` gets a type error instead of a field whose meaning has quietly changed.
- A bunker descriptor stored before this record has no `userPubkey`, so it reads as a new pairing, and its spent secret is sent and refused. An application that is upgrading adds the identity it used to pass as `userPubkey` to its stored bunker descriptor once. If it has no identity to add, the person pairs again.
- An application that never writes `userPubkey` back pairs again on every visit, which a bunker refuses once its secret has been spent. The write-back is part of using a bunker, unlike the relays, which have a fallback.
- Shared decision: nostr-adrs ADR-0060.
