import { assert, assertEquals } from "@std/assert"
import type { NostrEvent, NostrFilter } from "@innis/nostr-core"
import { buildEventFixture, relayUrlFixture } from "@innis/nostr-core/testing"
import type { Nip46SubscriptionStatus } from "@innis/nostr-nip46"
import type { PoolSubscription, PublishResponse, SubscribeManyCallbacks } from "@innis/nostr-relay-pool"
import type { Nip46RelayPool } from "../src/relay-pool-transport.ts"
import { RelayPoolTransport } from "../src/relay-pool-transport.ts"

interface Leg {
  readonly urls: ReadonlyArray<string>
  readonly filters: ReadonlyArray<NostrFilter>
  readonly callbacks: SubscribeManyCallbacks
  readonly live: boolean
  unsubscribed: boolean
}

class FakePool implements Nip46RelayPool {
  readonly legs: Array<Leg> = []
  readonly published: Array<string> = []

  subscribeMany = (
    urls: ReadonlyArray<string>,
    filters: ReadonlyArray<NostrFilter>,
    callbacks: SubscribeManyCallbacks,
  ): PoolSubscription => this.open({ urls, filters, callbacks, live: false, unsubscribed: false })

  subscribeManyLive = (
    urls: ReadonlyArray<string>,
    filters: ReadonlyArray<NostrFilter>,
    callbacks: SubscribeManyCallbacks,
  ): PoolSubscription => this.open({ urls, filters, callbacks, live: true, unsubscribed: false })

  private open = (leg: Leg): PoolSubscription => {
    this.legs.push(leg)

    return {
      unsubscribe: (): void => {
        leg.unsubscribed = true
      },
      syncUrls: (): void => {},
    }
  }

  publish = (url: string): Promise<PublishResponse> => {
    this.published.push(url)

    return Promise.resolve({ from: relayUrlFixture(url), ok: true, message: "" })
  }

  dispose = (): void => {}
}

const anEvent = (): NostrEvent => buildEventFixture({ kind: 24133 })

const listeningOn = (
  urls: ReadonlyArray<string>,
  onEvent: (event: NostrEvent) => void = () => {},
  onStatus?: (status: Nip46SubscriptionStatus) => void,
) => ({
  filter: { kinds: [24133] },
  relays: urls.map((url) => relayUrlFixture(url)),
  onEvent,
  onStatus,
})

/**
 * The bug this exists for. A leg that is not live closes itself once the relay has
 * sent everything it already held, and a NIP-46 reply is not in that backlog — it is
 * published in answer to a request sent afterwards. It arrived at a subscription that no
 * longer existed, so every pairing failed on the client's own sixty-second timeout.
 */
Deno.test("the subscription stays open past the relay's backlog", () => {
  const pool = new FakePool()

  new RelayPoolTransport(pool).subscribe(listeningOn(["wss://bunker.example"]))

  assertEquals(pool.legs.length, 1)
  assertEquals(pool.legs[0]?.live, true)
})

Deno.test("an event arriving after the backlog still reaches the caller", () => {
  const pool = new FakePool()
  const received: Array<NostrEvent> = []

  new RelayPoolTransport(pool).subscribe(
    listeningOn(["wss://bunker.example"], (event) => received.push(event)),
  )

  pool.legs[0]?.callbacks.onRelayEose?.(relayUrlFixture("wss://bunker.example"))
  pool.legs[0]?.callbacks.onEvent(anEvent(), relayUrlFixture("wss://bunker.example"))

  assertEquals(received.length, 1)
})

Deno.test("every relay the bunker named is subscribed on", () => {
  const pool = new FakePool()

  new RelayPoolTransport(pool).subscribe(
    listeningOn(["wss://one.example", "wss://two.example"]),
  )

  assertEquals(pool.legs[0]?.urls, ["wss://one.example", "wss://two.example"])
})

Deno.test("the filter is passed through as the client wrote it", () => {
  const pool = new FakePool()

  new RelayPoolTransport(pool).subscribe(listeningOn(["wss://bunker.example"]))

  assertEquals(pool.legs[0]?.filters, [{ kinds: [24133] }])
})

Deno.test("aborting closes the subscription", () => {
  const pool = new FakePool()

  new RelayPoolTransport(pool).subscribe(listeningOn(["wss://bunker.example"])).abort()

  assert(pool.legs[0]?.unsubscribed)
})

/** The pool opens one leg per distinct relay, however often the bunker url named it. */
Deno.test("a relay named twice closes once, and the subscription still reports closed", () => {
  const pool = new FakePool()
  const statuses: Array<Nip46SubscriptionStatus> = []

  new RelayPoolTransport(pool).subscribe(
    listeningOn(["wss://one.example", "wss://one.example"], () => {}, (status) => statuses.push(status)),
  )

  pool.legs[0]?.callbacks.onRelayClosed?.(relayUrlFixture("wss://one.example"), "gone")

  assertEquals(statuses, ["pending", "closed"])
})

Deno.test("publishing reports whether the relay took it", async () => {
  const pool = new FakePool()

  const result = await new RelayPoolTransport(pool)
    .publish(relayUrlFixture("wss://bunker.example"), anEvent())

  assertEquals(result.ok, true)
  assertEquals(pool.published, ["wss://bunker.example"])
})

Deno.test("status runs pending, then active on the first backlog end, then closed when every leg dies", () => {
  const pool = new FakePool()
  const statuses: Array<Nip46SubscriptionStatus> = []

  new RelayPoolTransport(pool).subscribe(
    listeningOn(["wss://one.example", "wss://two.example"], () => {}, (status) => statuses.push(status)),
  )

  pool.legs[0]?.callbacks.onRelayEose?.(relayUrlFixture("wss://one.example"))
  pool.legs[0]?.callbacks.onRelayEose?.(relayUrlFixture("wss://two.example"))
  pool.legs[0]?.callbacks.onRelayClosed?.(relayUrlFixture("wss://one.example"), "gone")
  pool.legs[0]?.callbacks.onRelayClosed?.(relayUrlFixture("wss://two.example"), "gone")

  assertEquals(statuses, ["pending", "active", "closed"])
})
