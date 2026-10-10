package com.swarm.ai.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.swarm.ai.model.Agent

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier = modifier) {
        Column(Modifier.padding(16.dp)) {
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
fun HomeScreen(
    state: HomeUiState,
    onNavigateToModels: () -> Unit,
    onNavigateToBuild: () -> Unit,
    onRefresh: () -> Unit,
    onNavigateToRemote: () -> Unit = {}
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Swarm Overview", fontWeight = FontWeight.Bold) },
                actions = {
                    IconButton(onClick = onRefresh) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatCard("Active Agents", state.activeAgentsCount.toString(), Modifier.weight(1f))
                StatCard("Completed Tasks", state.completedTasksCount.toString(), Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatCard("System Health", "${state.systemHealth}%", Modifier.weight(1f))
                StatCard("Selected Model", state.selectedModelName, Modifier.weight(1f))
            }
            Text("Recent Activity", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            state.recentLogs.forEach { Text("- $it", style = MaterialTheme.typography.bodyMedium) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onNavigateToModels) { Text("Manage Models") }
                OutlinedButton(onClick = onNavigateToBuild) { Text("New Swarm Task") }
            }
            Button(onClick = onNavigateToRemote, modifier = Modifier.fillMaxWidth()) {
                Text("Remote Control (PC)")
            }
        }
    }
}

@Composable
fun AgentsScreen(
    agents: List<Agent>,
    onAddAgent: () -> Unit,
    onToggleAgentStatus: (Agent) -> Unit
) {
    Scaffold(
        topBar = { TopAppBar(title = { Text("Swarm Agents", fontWeight = FontWeight.Bold) }) },
        floatingActionButton = {
            FloatingActionButton(onClick = onAddAgent) {
                Icon(Icons.Default.Add, contentDescription = "Add agent")
            }
        }
    ) { padding ->
        LazyColumn(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(agents, key = { it.id }) { agent ->
                Card(Modifier.fillMaxWidth()) {
                    Row(
                        Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(agent.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text(agent.role, style = MaterialTheme.typography.bodyMedium)
                            Text(
                                agent.currentTask ?: agent.status,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                        IconButton(onClick = { onToggleAgentStatus(agent) }) {
                            Icon(
                                if (agent.status == "Active") Icons.Default.Pause else Icons.Default.PlayArrow,
                                contentDescription = "Toggle ${agent.name}"
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun BuildScreen(
    state: BuildUiState,
    onPromptChange: (String) -> Unit,
    onExecute: () -> Unit
) {
    Scaffold(topBar = { TopAppBar(title = { Text("Build Swarm Task", fontWeight = FontWeight.Bold) }) }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            OutlinedTextField(
                value = state.prompt,
                onValueChange = onPromptChange,
                label = { Text("Describe the task") },
                modifier = Modifier.fillMaxWidth(),
                minLines = 3
            )
            Button(
                onClick = onExecute,
                enabled = !state.isExecuting && state.prompt.isNotBlank(),
                modifier = Modifier.fillMaxWidth()
            ) { Text(if (state.isExecuting) "Running..." else "Execute") }
            if (state.output.isNotEmpty()) {
                Text(state.output, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
fun SettingsScreen(
    state: SettingsUiState,
    onUpdateSettings: (SettingsUiState) -> Unit,
    onResetDefaults: () -> Unit
) {
    Scaffold(topBar = { TopAppBar(title = { Text("Settings", fontWeight = FontWeight.Bold) }) }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Local TFLite Inference", Modifier.weight(1f))
                Switch(
                    checked = state.localInferenceEnabled,
                    onCheckedChange = { onUpdateSettings(state.copy(localInferenceEnabled = it)) }
                )
            }
            Text("Temperature: ${"%.2f".format(state.temperature)}")
            Slider(
                value = state.temperature,
                onValueChange = { onUpdateSettings(state.copy(temperature = it)) },
                valueRange = 0f..2f
            )
            OutlinedTextField(
                value = state.ollamaEndpoint,
                onValueChange = { onUpdateSettings(state.copy(ollamaEndpoint = it)) },
                label = { Text("Ollama endpoint") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Text("Max tokens: ${state.maxTokens}")
            OutlinedButton(onClick = onResetDefaults) { Text("Reset to defaults") }
        }
    }
}