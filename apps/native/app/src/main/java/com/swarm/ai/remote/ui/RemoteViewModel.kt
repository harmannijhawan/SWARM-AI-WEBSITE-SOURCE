package com.swarm.ai.remote.ui

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.swarm.ai.remote.RemoteAgent
import com.swarm.ai.remote.RemoteClient
import com.swarm.ai.remote.RemoteException
import com.swarm.ai.remote.WsEvent
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class LinkMode { CONNECTING, LIVE, POLLING, OFFLINE }

data class RemoteUiState(
    val paired: Boolean = false,
    val pcName: String = "",
    val routeLabel: String? = null,
    val routeAddress: String? = null,
    val link: LinkMode = LinkMode.CONNECTING,
    val agents: List<RemoteAgent> = emptyList(),
    val refreshing: Boolean = false,
    val pairingInProgress: Boolean = false,
    val busyAgentId: String? = null,
    val message: String? = null
)

@HiltViewModel
class RemoteViewModel @Inject constructor(
    private val client: RemoteClient,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val _state = MutableStateFlow(
        RemoteUiState(paired = client.isPaired, pcName = client.pairing.value?.pcName ?: "")
    )
    val state: StateFlow<RemoteUiState> = _state.asStateFlow()

    private var liveJob: Job? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    init {
        viewModelScope.launch {
            client.pairing.collect { rec ->
                _state.update { it.copy(paired = rec != null, pcName = rec?.pcName ?: "") }
                if (rec == null) stopLive()
            }
        }
        viewModelScope.launch {
            client.activeRoute.collect { r ->
                _state.update { it.copy(routeLabel = r?.label, routeAddress = r?.endpoint?.display) }
            }
        }
    }

    // ---------------------------------------------------------- pairing

    fun pair(qrText: String) {
        if (_state.value.pairingInProgress) return
        _state.update { it.copy(pairingInProgress = true, message = null) }
        viewModelScope.launch {
            try {
                client.pair(qrText)
                _state.update { it.copy(pairingInProgress = false, message = "Paired") }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(pairingInProgress = false, message = e.message ?: "Pairing failed") }
            }
        }
    }

    fun unpair() {
        stopLive()
        client.unpair()
        _state.update { RemoteUiState(message = "Unpaired") }
    }

    fun consumeMessage() = _state.update { it.copy(message = null) }

    // ---------------------------------------------------------- live updates

    /** Call when the control screen becomes visible. Safe to call repeatedly. */
    fun startLive() {
        if (liveJob?.isActive == true || !client.isPaired) return
        liveJob = viewModelScope.launch { liveLoop() }
    }

    fun stopLive() {
        liveJob?.cancel()
        liveJob = null
    }

    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(refreshing = true) }
            try {
                val agents = client.listAgents()
                _state.update { it.copy(agents = agents, refreshing = false) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(refreshing = false, message = e.message) }
                if (e is RemoteException.Network || e is RemoteException.NoRoute) restartLive()
            }
        }
    }

    private fun restartLive() {
        liveJob?.cancel()
        liveJob = null
        client.invalidateRoute()
        startLive()
    }

    private suspend fun liveLoop() {
        var backoffMs = 2000L
        while (viewModelScope.isActive && client.isPaired) {
            try {
                _state.update { it.copy(link = LinkMode.CONNECTING) }
                client.ensureRoute()
                backoffMs = 2000L

                // Preferred: authenticated WebSocket.
                var revoked = false
                try {
                    client.events().collect { ev ->
                        when (ev) {
                            is WsEvent.Agents -> _state.update { it.copy(agents = ev.agents, link = LinkMode.LIVE) }
                            is WsEvent.Hello -> _state.update { it.copy(link = LinkMode.LIVE) }
                            is WsEvent.Closed -> if (ev.code == 4401) revoked = true
                                else _state.update { it.copy(link = LinkMode.CONNECTING) }
                            is WsEvent.Failure -> _state.update { it.copy(link = LinkMode.OFFLINE, message = ev.error.message) }
                            else -> Unit
                        }
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: RemoteException.Unauthorized) {
                    return
                } catch (_: Exception) {
                    // fall through to REST polling
                }

                if (revoked) {
                    client.unpair()
                    return
                }

                // Fallback: REST polling every 3 s (then retry the socket).
                repeat(5) {
                    val agents = client.listAgents()
                    _state.update { it.copy(agents = agents, link = LinkMode.POLLING) }
                    delay(3000)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: RemoteException.Unauthorized) {
                _state.update { it.copy(message = e.message) }
                return
            } catch (e: Exception) {
                client.invalidateRoute()
                _state.update { it.copy(link = LinkMode.OFFLINE, message = e.message) }
                delay(backoffMs)
                backoffMs = (backoffMs * 2).coerceAtMost(15_000L)
            }
        }
    }

    // ---------------------------------------------------------- commands

    fun start(agent: RemoteAgent) = command(agent) { client.startAgent(agent.id) }
    fun stop(agent: RemoteAgent) = command(agent) { client.stopAgent(agent.id) }
    fun sendTask(agent: RemoteAgent, text: String) = command(agent) { client.sendTask(agent.id, text.trim()) }

    private fun command(agent: RemoteAgent, block: suspend () -> RemoteAgent?) {
        if (_state.value.busyAgentId != null) return
        _state.update { it.copy(busyAgentId = agent.id, message = null) }
        viewModelScope.launch {
            try {
                val updated = block()
                _state.update { s ->
                    s.copy(
                        busyAgentId = null,
                        agents = if (updated == null) s.agents else s.agents.map { if (it.id == updated.id) updated else it }
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(busyAgentId = null, message = e.message) }
            }
        }
    }

    // ---------------------------------------------------------- network changes

    private fun registerNetworkWatcher() {
        if (networkCallback != null) return
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onLost(network: Network) { viewModelScope.launch { restartLive() } }
            private var first = true
            override fun onAvailable(network: Network) {
                // The first callback is the current network; later ones mean the network changed: re-rank routes.
                if (first) { first = false; return }
                viewModelScope.launch { restartLive() }
            }
        }
        try {
            cm.registerDefaultNetworkCallback(cb)
            networkCallback = cb
        } catch (_: Exception) {
        }
    }

    private fun unregisterNetworkWatcher() {
        val cb = networkCallback ?: return
        networkCallback = null
        try {
            (context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager)?.unregisterNetworkCallback(cb)
        } catch (_: Exception) {
        }
    }

    override fun onCleared() {
        unregisterNetworkWatcher()
        super.onCleared()
    }
}
