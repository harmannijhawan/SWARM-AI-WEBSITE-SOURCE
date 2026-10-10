package com.swarm.ai.net.connectivity

import com.swarm.ai.remote.ConnectionInfo
import com.swarm.ai.remote.Route
import com.swarm.ai.remote.RouteClassifier
import com.swarm.ai.remote.RouteConnector

/**
 * Drop-in [RouteConnector] for `RemoteClient` that uses [connectBest] (happy-eyeballs race, staggered start,
 * last-known-good first). Because it implements the existing interface, wiring it needs only a change in
 * `RemoteModule` (see INTEGRATION.md) - no other remote/ code has to change.
 *
 * @param optionsFor builds the options per resolve (e.g. to refresh [ConnectOptions.ipv6Available] or bind to the
 *   active Network each time; the default re-detects IPv6 on every call).
 * @param onResult receives every [ConnectResult] (for logging / a diagnostics screen).
 */
class RaceRouteConnector(
    private val optionsFor: () -> ConnectOptions = { ConnectOptions(ipv6Available = Ipv6Support.detect()) },
    private val onResult: (ConnectResult) -> Unit = {}
) : RouteConnector {

    @Volatile
    var lastResult: ConnectResult? = null
        private set

    override suspend fun resolve(info: ConnectionInfo, preferred: Route?): Route? {
        val base = optionsFor()
        val options = base.copy(lastKnownGood = null)
        val result = connectBest(SimpleConnectTarget(info.hosts, info.fingerprint), options)
        lastResult = result
        onResult(result)
        val raw = result.endpoint?.raw ?: throw com.swarm.ai.remote.RemoteException.NoRoute(result.failureHint() + "\n" + result.summary())
        // Same classification the rest of the UI uses (label, display address).
        return RouteClassifier.classify(listOf(raw)).firstOrNull()
    }
}
