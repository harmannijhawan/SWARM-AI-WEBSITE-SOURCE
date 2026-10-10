package com.swarm.ai.data.repository

import com.swarm.ai.inference.TFLiteHelper
import com.swarm.ai.data.model.Agent
import com.swarm.ai.data.model.AgentStatus
import com.swarm.ai.data.model.AiModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ModelRepository @Inject constructor(
    private val tfLiteHelper: TFLiteHelper
) {
    private val _models = MutableStateFlow(
        listOf(
            AiModel("m1", "Swarm-Llama-3B", "Optimized on-device LLM for swarm coordination", "v1.2", 1250f, true, "LLM", "New"),
            AiModel("m2", "AgentNet-Tiny", "Ultralight neural routing for agent swarms", "v2.0", 320f, true, "Routing", "Beta"),
            AiModel("m3", "VisionSwarm-Nano", "Distributed computer vision agent model", "v1.0", 640f, false, "Vision"),
            AiModel("m4", "DecisionForest-X", "Ensemble model for rapid consensus building", "v1.5", 180f, true, "Consensus")
        )
    )
    val models: Flow<List<AiModel>> = _models.asStateFlow()

    private val _agents = MutableStateFlow(
        listOf(
            Agent("a1", "Alpha Scout", "Data Gathering & Exploration", AgentStatus.RUNNING, 0.78f, 0.94f),
            Agent("a2", "Beta Consensus", "Distributed Voting & Validation", AgentStatus.RUNNING, 0.65f, 0.98f),
            Agent("a3", "Gamma Executor", "Task Execution & Synthesis", AgentStatus.IDLE, 0.12f, 0.91f),
            Agent("a4", "Delta Sentinel", "Security & Anomaly Detection", AgentStatus.RUNNING, 0.89f, 0.96f)
        )
    )
    val agents: Flow<List<Agent>> = _agents.asStateFlow()

    suspend fun downloadModel(modelId: String) {
        kotlinx.coroutines.delay(1000)
        _models.value = _models.value.map {
            if (it.id == modelId) it.copy(isDownloaded = true) else it
        }
    }

    suspend fun toggleAgentStatus(agentId: String) {
        _agents.value = _agents.value.map { agent ->
            if (agent.id == agentId) {
                val newStatus = if (agent.status == AgentStatus.RUNNING) AgentStatus.PAUSED else AgentStatus.RUNNING
                agent.copy(status = newStatus)
            } else {
                agent
            }
        }
    }

    suspend fun runDemoTask(inputData: FloatArray): FloatArray {
        return tfLiteHelper.runInference(inputData)
    }
}
