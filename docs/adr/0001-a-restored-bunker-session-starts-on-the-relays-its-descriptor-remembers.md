# 0001. A restored bunker session starts on the relays its descriptor remembers

## Status

Accepted

## Context

NIP-46's `switch_relays` lets a signer move a client onto the signer's own relays during the handshake, and a client is expected to honour the move. The move happens once, as part of the initial handshake. A session restored from a stored descriptor already knows the visitor's pubkey, so it sends no `connect` and the signer never moves it again.

A signer that later migrates relays — its old URL names relays it has left — therefore strands every restored client on relays nobody answers, while fresh pairings work. The descriptor is the only thing that survives between sessions, and before this record it remembered the bunker URL and the client key but not where the signer last put the client.

## Decision

- The bunker descriptor carries an optional `relays`, the set `switch_relays` moved the client to at the last `connect`. The application writes it back from the session's `getRelayUrls()` after connecting.
- A restored session starts on the remembered relays instead of the bunker URL's. Storage is untrusted, so each remembered entry is parsed at the edge: an entry that does not parse is dropped, and when none survive the bunker URL's own relays are the fallback.
- `isSignerDescriptor` accepts the field absent (descriptors written before the first connect, or by older versions) and rejects a value that is not a list.

## Consequences

- A signer that migrates relays keeps its restored clients, which is the case `switch_relays` exists for.
- The descriptor stays JSON all the way down, and an old descriptor reads exactly as before.
- An application that never writes the relays back gets the old behaviour: every restored session starts from the bunker URL's relays.
