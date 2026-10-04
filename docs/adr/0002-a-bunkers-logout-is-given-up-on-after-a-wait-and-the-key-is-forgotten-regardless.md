# 0002. A bunker's logout is given up on after a wait, and the key is forgotten regardless

## Status

Accepted

## Context

NIP-46's `logout` asks the signer to forget the client, and the same NIP has the client delete its own key whether or not the signer acknowledges — the request is a courtesy, and the client's forgetfulness is the guarantee. A signer may be offline, its relays gone, or simply never answer, and logout involves no person whose approval could take time: a signer that is going to answer does so within a relay round trip.

Waiting indefinitely for the ack would hold the application's sign-out open on a reply that is not coming. Settling instantly would report success for a logout nobody heard, or a failure for one that landed a moment later.

## Decision

- `logout(timeoutMs)` sends the signer's `logout` and waits `timeoutMs` — five seconds by default, a generous relay round trip — for the answer. When the wait lapses the session disconnects, which settles the pending logout as a `disconnected` failure, and that outcome is returned, not thrown.
- Whatever the outcome, ending the session is the application's part: it deletes the stored descriptor's client key on any return value.
- An extension has nothing to log out of and answers `ok` at once, so no caller has to know which kind it holds.

## Consequences

- Sign-out never hangs on a silent signer, and a live signer's acknowledgement is still reported.
- The `disconnected` failure on a give-up tells the application the courtesy was not heard, while its own guarantee — forgetting the client key — is unaffected either way.
