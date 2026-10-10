package com.swarm.ai.domain.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.swarm.ai.data.model.Agent
import com.swarm.ai.data.model.AiModel
import com.swarm.ai.data.repository.ModelRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val modelRepository: ModelRepository
) : ViewModel() {

    val models: StateFlow<List<AiModel>> = modelRepository.models
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    val agents: StateFlow<List<Agent>> = modelRepository.agents
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun downloadModel(modelId: String) {
        viewModelScope.launch {
            modelRepository.downloadModel(modelId)
        }
    }

    fun toggleAgent(agentId: String) {
        viewModelScope.launch {
            modelRepository.toggleAgentStatus(agentId)
        }
    }

    suspend fun runDemoTask(input: FloatArray): FloatArray {
        return modelRepository.runDemoTask(input)
    }
}
