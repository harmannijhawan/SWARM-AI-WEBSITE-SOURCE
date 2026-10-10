package com.swarm.ai.remote.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.LinkOff
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.swarm.ai.remote.RemoteAgent

/** Entry point used by the app navigation graph: scan screen until paired, then the remote control screen. */
@Composable
fun RemoteRoute(onBack: () -> Unit, vm: RemoteViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(state.message) {
        state.message?.let {
            snackbar.showSnackbar(it)
            vm.consumeMessage()
        }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Box(Modifier.padding(padding)) {
            if (state.paired) {
                RemoteControlScreen(
                    state = state,
                    onBack = onBack,
                    onRefresh = vm::refresh,
                    onStart = vm::start,
                    onStop = vm::stop,
                    onSendTask = vm::sendTask,
                    onUnpair = vm::unpair,
                    onVisible = vm::startLive,
                    onHidden = vm::stopLive
                )
            } else {
                PairScreen(state = state, onBack = onBack, onPayload = vm::pair)
            }
        }
    }
}

// ------------------------------------------------------------------ pairing screen

@Composable
fun PairScreen(state: RemoteUiState, onBack: () -> Unit, onPayload: (String) -> Unit) {
    var pasted by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("Pair with PC", fontWeight = FontWeight.Bold) },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            }
        )
        Text(
            "On the PC open SWARM > Remote and show the pairing code, then point the camera at it.",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            style = MaterialTheme.typography.bodyMedium
        )
        if (state.pairingInProgress) {
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                CircularProgressIndicator()
                Spacer(Modifier.height(12.dp))
                Text("Finding your PC and pairing...")
            }
        } else {
            QrScannerView(onQrText = onPayload, modifier = Modifier.weight(1f).fillMaxWidth())
        }
        OutlinedTextField(
            value = pasted,
            onValueChange = { pasted = it },
            label = { Text("Or paste the pairing code") },
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            maxLines = 2
        )
        Button(
            onClick = { onPayload(pasted) },
            enabled = pasted.isNotBlank() && !state.pairingInProgress,
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) { Text("Pair") }
    }
}

// ------------------------------------------------------------------ control screen

@Composable
fun RemoteControlScreen(
    state: RemoteUiState,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onStart: (RemoteAgent) -> Unit,
    onStop: (RemoteAgent) -> Unit,
    onSendTask: (RemoteAgent, String) -> Unit,
    onUnpair: () -> Unit,
    onVisible: () -> Unit,
    onHidden: () -> Unit
) {
    DisposableEffect(Unit) {
        onVisible()
        onDispose { onHidden() }
    }

    var taskFor by remember { mutableStateOf<RemoteAgent?>(null) }
    var confirmUnpair by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(state.pcName.ifEmpty { "Remote control" }, fontWeight = FontWeight.Bold) },
            navigationIcon = {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
            },
            actions = {
                IconButton(onClick = { confirmUnpair = true }) {
                    Icon(Icons.Default.LinkOff, contentDescription = "Unpair")
                }
            }
        )
        ConnectionBanner(state)
        PullToRefreshBox(
            isRefreshing = state.refreshing,
            onRefresh = onRefresh,
            modifier = Modifier.weight(1f)
        ) {
            if (state.agents.isEmpty()) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        if (state.link == LinkMode.OFFLINE) "PC not reachable. Retrying..." else "No projects found.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            } else {
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    items(state.agents, key = { it.id }) { agent ->
                        AgentCard(
                            agent = agent,
                            busy = state.busyAgentId == agent.id,
                            onStart = { onStart(agent) },
                            onStop = { onStop(agent) },
                            onTask = { taskFor = agent }
                        )
                    }
                }
            }
        }
    }

    taskFor?.let { agent ->
        var text by remember(agent.id) { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { taskFor = null },
            title = { Text("Send task to ${agent.name}") },
            text = {
                OutlinedTextField(
                    value = text,
                    onValueChange = { if (it.length <= 8000) text = it },
                    label = { Text("Task or instruction") },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(
                    enabled = text.isNotBlank(),
                    onClick = {
                        onSendTask(agent, text)
                        taskFor = null
                    }
                ) { Text("Send") }
            },
            dismissButton = { TextButton(onClick = { taskFor = null }) { Text("Cancel") } }
        )
    }

    if (confirmUnpair) {
        AlertDialog(
            onDismissRequest = { confirmUnpair = false },
            title = { Text("Unpair this phone?") },
            text = { Text("The pairing key and secret are removed from this phone. You will need to scan a new code to reconnect.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmUnpair = false
                    onUnpair()
                }) { Text("Unpair") }
            },
            dismissButton = { TextButton(onClick = { confirmUnpair = false }) { Text("Cancel") } }
        )
    }
}

@Composable
private fun ConnectionBanner(state: RemoteUiState) {
    val (text, color) = when (state.link) {
        LinkMode.LIVE -> "Live" to MaterialTheme.colorScheme.primaryContainer
        LinkMode.POLLING -> "Refreshing every 3 s" to MaterialTheme.colorScheme.secondaryContainer
        LinkMode.CONNECTING -> "Connecting..." to MaterialTheme.colorScheme.surfaceVariant
        LinkMode.OFFLINE -> "Offline - reconnecting" to MaterialTheme.colorScheme.errorContainer
    }
    Surface(color = color, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            Text(text, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
            val route = state.routeLabel
            Text(
                if (route != null) "Route: $route (${state.routeAddress})" else "Route: searching...",
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}

@Composable
private fun AgentCard(
    agent: RemoteAgent,
    busy: Boolean,
    onStart: () -> Unit,
    onStop: () -> Unit,
    onTask: () -> Unit
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    agent.name,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                AssistChip(onClick = {}, label = { Text(agent.status) })
            }
            agent.task?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 3, overflow = TextOverflow.Ellipsis) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                FilledTonalButton(onClick = onStart, enabled = !busy && agent.status != "running") {
                    Icon(Icons.Default.PlayArrow, contentDescription = null)
                    Spacer(Modifier.width(4.dp))
                    Text("Start")
                }
                OutlinedButton(onClick = onStop, enabled = !busy && agent.status == "running") {
                    Icon(Icons.Default.Stop, contentDescription = null)
                    Spacer(Modifier.width(4.dp))
                    Text("Stop")
                }
                OutlinedButton(onClick = onTask, enabled = !busy) {
                    Icon(Icons.Default.Send, contentDescription = null)
                    Spacer(Modifier.width(4.dp))
                    Text("Task")
                }
                if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            }
        }
    }
}