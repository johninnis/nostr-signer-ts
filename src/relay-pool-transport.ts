import { createRelayPool } from "@innis/nostr-relay-pool"
import type { RelayPool } from "@innis/nostr-relay-pool"
import type { Nip46PublishResult, Nip46SubscribeOptions, Nip46Subscription, Nip46Transport } from "@innis/nostr-nip46"
import type { NostrEvent, RelayUrl } from "@innis/nostr-core"

/**
 * The part of a RelayPool a NIP-46 conversation uses.
 *
 * Three methods of about twenty. Depending on the whole thing would mean anything standing
 * in for it — a test double, a pool wrapped in something — had to answer for methods this
 * never calls, and the only way to do that is to lie about the type.
 */
export interface Nip46RelayPool {
  /** Fan a subscription out across the bunker's relays. */
  readonly subscribeMany: RelayPool["subscribeMany"]
  /** Publish one envelope to one relay. */
  readonly publish: RelayPool["publish"]
  /** Close every socket the conversation opened. */
  readonly dispose: RelayPool["dispose"]
}

/**
 * A `Nip46Transport` over a relay pool.
 *
 * A bunker is reached over relays, so NIP-46 needs a transport where a page may otherwise
 * open no sockets at all. It is built when someone pairs or signs and disposed after, and
 * the relays are the bunker's own, taken from the `bunker://` URL — no relay list is
 * fetched and none of the visitor's own relays are contacted: this connection exists to
 * carry one conversation with one signer.
 *
 * Subscriptions are persistent. A leg that is not persistent closes itself the moment the
 * relay says it has sent everything it already had, and a NIP-46 reply is never in that
 * backlog — it is published in answer to the request about to be sent, so it always arrives
 * afterwards, to a subscription that would no longer exist.
 *
 * Status is reported as the NIP-46 contract asks: `pending` on opening, `active` when the
 * first relay reaches end-of-stored-events, `closed` when every leg has terminally closed.
 * The pool opens one leg per distinct relay however often a relay is named, so closure is
 * counted against the distinct relays, not the list as it was given.
 */
export class RelayPoolTransport implements Nip46Transport {
  private readonly pool: Nip46RelayPool

  /** Runs over the given pool; when none is injected, a fresh real one that opens no sockets until asked. */
  constructor(pool: Nip46RelayPool = createRelayPool()) {
    this.pool = pool
  }

  /** Opens a persistent multi-relay subscription and returns a handle to abort it. */
  subscribe = (options: Nip46SubscribeOptions): Nip46Subscription => {
    const distinctRelays = new Set(options.relays).size
    const closedRelays = new Set<RelayUrl>()
    let sawEose = false

    options.onStatus?.("pending")

    const subscription = this.pool.subscribeMany(
      [...options.relays],
      [options.filter],
      {
        onEvent: (event: NostrEvent) => options.onEvent(event),
        onRelayEose: () => {
          if (sawEose) return
          sawEose = true
          options.onStatus?.("active")
        },
        onRelayClosed: (relayUrl: RelayUrl) => {
          if (closedRelays.has(relayUrl)) return
          closedRelays.add(relayUrl)
          if (closedRelays.size === distinctRelays) options.onStatus?.("closed")
        },
      },
      { persistent: true },
    )

    return { abort: () => subscription.unsubscribe() }
  }

  /** Publishes one envelope to one relay and reports whether that relay accepted it. */
  publish = async (relayUrl: RelayUrl, event: NostrEvent): Promise<Nip46PublishResult> => {
    const response = await this.pool.publish(relayUrl, event)

    return { ok: response.ok }
  }

  /**
   * Closes every socket. Called once the signer is finished with, so a page that paired
   * with a bunker does not sit holding connections open for the rest of the visit.
   */
  dispose(): void {
    this.pool.dispose()
  }
}
