package com.swarm.ai.ui.screens

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.swarm.ai.data.repository.SwarmRepository
import com.swarm.ai.model.Agent
import com.swarm.ai.model.AiModel
import com.swarm.ai.model.SwarmSettings
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

// ---------------------------------------------------------------- Home

data class HomeUiState(
    val activeAgentsCount: Int = 0,
    val completedTasksCount: Int = 0,
    val systemHealth: Int = 100,
    val selectedModelName: String = "None",
    val recentLogs: List<String> = emptyList()
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val repository: SwarmRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    private var job: Job? = null

    init {
        observe()
    }

    fun refresh() = observe()

    private fun observe() {
        job?.cancel()
        job = viewModelScope.launch {
            combine(
                repository.getAgents(),
                repository.getModels(),
                repository.getSettings()
            ) { agents: List<Agent>, models: List<AiModel>, settings: SwarmSettings ->
                val perf = agents.map { it.performance }.filter { it > 0f }
                HomeUiState(
                    activeAgentsCount = agents.count { it.status != "Offline" && it.status != "Stopped" },
                    completedTasksCount = agents.sumOf { it.tasksCompleted },
                    systemHealth = if (perf.isEmpty()) 100 else perf.average().toInt().coerceIn(0, 100),
                    selectedModelName = models.firstOrNull { it.id == settings.selectedModelId }?.name
                        ?: models.firstOrNull { it.isDefault }?.name
                        ?: "None",
                    recentLogs = agents.take(5).map { "${it.name} - ${it.status}" }
                )
            }.collect { _uiState.value = it }
        }
    }
}

// ---------------------------------------------------------------- Models

data class ModelsUiState(val models: List<AiModel> = emptyList())

@HiltViewModel
class ModelsViewModel @Inject constructor(
    private val repository: SwarmRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(ModelsUiState())
    val uiState: StateFlow<ModelsUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.getModels().collect { models -> _uiState.value = ModelsUiState(models) }
        }
    }
}

// ---------------------------------------------------------------- Agents

data class AgentsUiState(val agents: List<Agent> = emptyList())

@HiltViewModel
class AgentsViewModel @Inject constructor(
    private val repository: SwarmRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(AgentsUiState())
    val uiState: StateFlow<AgentsUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            repository.getAgents().collect { agents -> _uiState.value = AgentsUiState(agents) }
        }
    }

    fun addAgent() {
        viewModelScope.launch {
            val n = _uiState.value.agents.size + 1
            repository.updateAgent(
                Agent(
                    id = "agent-${System.currentTimeMillis()}",
                    name = "Agent-$n",
                    role = "Worker",
                    status = "Idle"
                )
            )
        }
    }

    fun toggleAgentStatus(agent: Agent) {
        viewModelScope.launch {
            repository.updateAgent(agent.copy(status = if (agent.status == "Active") "Idle" else "Active"))
        }
    }
}

// ---------------------------------------------------------------- Build

data class BuildUiState(
    val prompt: String = "",
    val isExecuting: Boolean = false,
    val output: String = ""
)

@HiltViewModel
class BuildViewModel @Inject constructor(
    private val repository: SwarmRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(BuildUiState())
    val uiState: StateFlow<BuildUiState> = _uiState.asStateFlow()

    private var agentCount = 0

    init {
        viewModelScope.launch {
            repository.getAgents().collect { agentCount = it.size }
        }
    }

    fun updatePrompt(text: String) {
        _uiState.update { it.copy(prompt = text) }
    }

    /** Runs the (simulated) swarm task off the main dispatcher; progress is streamed into [BuildUiState.output]. */
    fun executeTask() {
        val state = _uiState.value
        if (state.isExecuting || state.prompt.isBlank()) return
        val prompt = state.prompt
        _uiState.update { it.copy(isExecuting = true, output = "") }
        viewModelScope.launch(Dispatchers.Default) {
            val steps = listOf(
                "Analyzing prompt across swarm nodes...",
                "Distributing sub-tasks to agents...",
                "Synthesizing agent outputs...",
                "Done."
            )
            for (step in steps) {
                delay(400)
                _uiState.update { it.copy(output = it.output + step + "\n") }
            }
            try {
                repository.recordBuild(prompt, "Swarm", agentCount, steps.last())
            } catch (e: Exception) {
                _uiState.update { it.copy(output = it.output + "History not saved: ${e.message}\n") }
            }
            _uiState.update { it.copy(isExecuting = false) }
        }
    }
}

// ---------------------------------------------------------------- Settings

data class SettingsUiState(
    val selectedModelId: String = "",
    val localInferenceEnabled: Boolean = true,
    val temperature: Float = 0.7f,
    val maxTokens: Int = 2048,
    val ollamaEndpoint: String = "http://localhost:11434"
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val repository: SwarmRepository
) : ViewModel() {
    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    private var current = SwarmSettings()

    init {
        viewModelScope.launch {
            repository.getSettings().collect { s ->
                current = s
                _uiState.value = SettingsUiState(
                    selectedModelId = s.selectedModelId,
                    localInferenceEnabled = s.localInferenceEnabled,
                    temperature = s.temperature,
                    maxTokens = s.maxTokens,
                    ollamaEndpoint = s.ollamaEndpoint
                )
            }
        }
    }

    fun updateSettings(state: SettingsUiState) {
        _uiState.value = state
        viewModelScope.launch {
            repository.saveSettings(
                current.copy(
                    selectedModelId = state.selectedModelId,
                    localInferenceEnabled = state.localInferenceEnabled,
                    temperature = state.temperature,
                    maxTokens = state.maxTokens,
                    ollamaEndpoint = state.ollamaEndpoint
                )
            )
        }
    }

    fun resetDefaults() {
        viewModelScope.launch { repository.saveSettings(SwarmSettings(id = current.id)) }
    }
}