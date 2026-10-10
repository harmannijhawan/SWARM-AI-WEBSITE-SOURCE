# Connectivity layer - integration notes for Swarm Builder

Package `com.swarm.ai.net.connectivity` (all NEW files; no existing file was modified).

| File | Purpose |
|---|---|
| `HostParsing.kt` | Pure Kotlin: parse `host:port`, `[v6]:port`, `https://...`; unknown `scheme:` entries -> `Unsupported`; classification (LAN / global IPv6 / other), ordering, `mergeHosts`, `parseStatusHosts`. |
| `HappyEyeballs.kt` | `raceAttempts(...)`: staggered start (250 ms, or immediately when the previous attempt already failed), first success wins, rest cancelled, per-attempt report. |
| `PinnedPing.kt` | `PinnedPingProbe`: `GET /v1/ping` via OkHttp with the existing `remote.FingerprintTrustManager` (no system CAs, hostname check off). Optional `NetworkBinding`. |
| `ProbeErrors.kt` | Maps exceptions to `ProbeErrorKind` (timeout / unknown host / network unreachable / refused / cert mismatch / TLS ...). |
| `Connectivity.kt` | `connectBest(qr: QrPayload | PairingRecord | ConnectTarget, ConnectOptions)`, `ConnectResult` (endpoint + diagnostics), `TransportFactory` extension point, `EndpointMemory` + `rememberWorkingEndpoint`, `refreshHosts`. |
| `RaceRouteConnector.kt` | Implements the existing `remote.RouteConnector`; this is the one-line wiring for RemoteClient. |
| `AndroidNetworkBinding.kt` | Optional: bind probes to the active `Network`, IPv6 detection. |

## 1. Required wiring (RemoteClient.kt, `RemoteModule.provideRemoteClient`)

Current code builds
`CompositeRouteConnector(listOf(DirectRouteConnector(transport), ConnectivityFallbackConnector()))`.

Recommended: let the race replace the sequential direct prober (it already tries LAN -> IPv6 -> others, staggered,
last-known-good first) and keep `DirectRouteConnector` only as a safety net:

```kotlin
// RemoteClient.kt, imports:
import com.swarm.ai.net.connectivity.RaceRouteConnector

// in RemoteModule.provideRemoteClient(...):
val connector = CompositeRouteConnector(
    listOf(
        RaceRouteConnector(onResult = { android.util.Log.d("Connectivity", it.summary()) }),
        DirectRouteConnector(transport)          // optional fallback, can be dropped
    )
)
```
`ConnectivityFallbackConnector` (the TODO stub) can then be deleted or left unused.

Why this works without more changes: `RemoteClient.ensureRoute()` already passes `preferred` (= `PairingRecord.lastRoute`)
and persists the winning `route.endpoint.raw` as `lastRoute` - that IS the last-known-good memory, so no
`EndpointMemory` is needed in the app (it exists for other callers / tests). `pair()` also goes through the connector.

Return value mapping: the winner's host-list entry (`ConnectedEndpoint.raw`) is turned into a `Route` with the existing
`RouteClassifier.classify(listOf(raw))`, so `activeRoute.label/display` keep working.

## 2. Optional

* Diagnostics for the UI: `RaceRouteConnector.lastResult` (`ConnectResult.summary()`, `.diagnostics`, `.failureHint()`).
  Expose it from `RemoteClient` (e.g. `val lastConnectResult get() = raceConnector.lastResult`) and show
  `failureHint()` instead of the generic "Can't reach the PC right now." in `RemoteException.NoRoute`.
* Bind to the active network on reconnect after a network change (RemoteViewModel already calls
  `restartLive()` from its NetworkCallback). Pass
  `RaceRouteConnector(optionsFor = { ConnectOptions(ipv6Available = AndroidNetworks.hasGlobalIpv6(ctx) ?: Ipv6Support.detect(), probe = PinnedPingProbe(AndroidNetworks.bindToActiveNetwork(ctx))) })`
  (needs a `Context`, e.g. the `@ApplicationContext` already injected in `provideRemoteClient`).
* Persist host-list updates: after `refreshHosts(...)` returns `changed`, save
  `rec.copy(hosts = refresh.hosts)` with `store.save(...)` and update `_pairing`.

## 3. Host-list refresh (`GET /v1/status` `hosts`)

Protocol v1 (`docs/REMOTE_PROTOCOL.md` section 6, `/v1/status`) does **not** define a `hosts` field
(`{"v","pcName","appVersion","time","agentCount","runningCount"}`), so the PC cannot report new addresses today.
`refreshHosts(current) { client.status().toString() }` is implemented and is a no-op until the PC adds
`"hosts":["192.168.1.20:47821","[2401:db8::5]:47821", ...]` (same format/order rules as the QR) to `/v1/status`.
Suggested PC change (electron/remote): add that field to the status handler and document it in section 6.
Merge policy: PC-reported entries first (authoritative order), old entries not reported are kept after them
(`keepStale = true`, because manual/DDNS routes are unknown to the PC), max 16 entries.
Suggested call site: `RemoteClient.ensureRoute()` after a successful resolve -> `refreshHosts(rec.hosts) { status().toString() }`
(status() itself needs the route, so call it after `_route.value = route`; ignore failures).

## 4. Protocol doc note
Section 2 says "retry/re-rank on every reconnect" - done by `ensureRoute(force)` + `lastRoute`. `rtc:` and other
scheme-prefixed host entries are ignored (reported as `UNSUPPORTED` diagnostics) unless a `TransportFactory` is passed in
`ConnectOptions.transportFactories`. Note `QrPayloadParser` currently DROPS entries that `HostEndpoint.parseOrNull`
rejects, which includes `rtc:` entries - when a transport factory exists, relax that filter in Protocol.kt (keep
entries for which `HostParsing.parseEntry(h)` is not `Invalid`) so they survive into `PairingRecord.hosts`.

## 5. Dependencies
None added. Uses only what `app/build.gradle` already has: `okhttp:5.5.0`, `kotlinx-coroutines-android:1.11.0`
(brings coroutines-core), and for tests `junit:junit:4.13.2`, `kotlinx-coroutines-test:1.11.0`
(`testImplementation 'org.json:json'` is also present but not needed by these tests). Manifest already has INTERNET and
ACCESS_NETWORK_STATE.

## 6. Limitations
* The real TLS pin check is the existing `FingerprintTrustManager` and is NOT covered by a JVM test here (no
  MockWebServer / okhttp-tls in the dependencies; a self-signed HTTPS server would need those). The race, parsing,
  ordering and error mapping are unit-tested with a fake `PingProbe`.
* Host names (DDNS) are resolved by OkHttp's `Dns` (all A/AAAA records tried by OkHttp itself); a single hostname
  entry is one candidate.
* A custom `TransportFactory` attempt must return an HTTPS `baseUrl`; WebSocket/REST code in remote/ derives its URL from
  `Route.endpoint.baseUrl`, which currently comes from `HostEndpoint.parseOrNull(raw)`, i.e. only direct entries can
  become a `Route` today (`RaceRouteConnector` returns null for a winner it cannot classify).
