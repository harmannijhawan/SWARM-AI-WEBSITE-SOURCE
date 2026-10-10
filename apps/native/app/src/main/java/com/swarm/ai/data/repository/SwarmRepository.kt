package com.swarm.ai.data.repository

import com.swarm.ai.data.local.SwarmDao
import com.swarm.ai.model.Agent
import com.swarm.ai.model.AIModel
import com.swarm.ai.model.AppSettings
import com.swarm.ai.model.BuildHistory
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SwarmRepository @Inject constructor(private val swarmDao: SwarmDao) {

    val agents: Flow<List<Agent>> = swarmDao.getAllAgents()
    val models: Flow<List<AIModel>> = swarmDao.getAllModels()
    val settings: Flow<AppSettings?> = swarmDao.getSettings()
    val buildHistory: Flow<List<BuildHistory>> = swarmDao.getBuildHistory()

    @JvmName("fetchAgents")
    fun getAgents(): Flow<List<Agent>> = agents
    @JvmName("fetchModels")
    fun getModels(): Flow<List<AIModel>> = models
    @JvmName("fetchSettings")
    fun getSettings(): Flow<AppSettings> = settings.map { it ?: AppSettings() }

    suspend fun seedIfEmpty() {
        if (swarmDao.countAgents() == 0) seedInitialData()
    }

    suspend fun seedInitialData() {
        val initialAgents = listOf(
            Agent("1", "Alpha-Coordinator", "Leader", "Active", "Llama-3-8B", 98.4f, 1420, "Task Orchestration"),
            Agent("2", "Beta-Coder", "Developer", "Active", "CodeLlama-7B", 96.1f, 890, "Code Generation"),
            Agent("3", "Gamma-Analyst", "Research", "Idle", "Mistral-7B", 94.8f, 650, "Data Synthesis"),
            Agent("4", "Delta-Security", "Reviewer", "Active", "Phi-3-mini", 99.2f, 1120, "Vulnerability Scanning")
        )

        val initialModels = listOf(
            AIModel("m1", "Llama-3 8B Instruct", "Meta", "4.7 GB", "Downloaded", "INT4", true),
            AIModel("m2", "CodeLlama 7B", "Meta", "3.8 GB", "Downloaded", "INT8", false),
            AIModel("m3", "Mistral 7B v0.3", "Mistral AI", "4.1 GB", "Available", "INT4", false),
            AIModel("m4", "Phi-3 Mini 4k", "Microsoft", "2.3 GB", "Downloaded", "INT4", false)
        )

        swarmDao.insertAgents(initialAgents)
        swarmDao.insertModels(initialModels)
        swarmDao.saveSettings(AppSettings(id = 1, activeProvider = "Local TFLite", localInferenceEnabled = true, selectedModelId = "m1"))
    }

    suspend fun updateAgent(agent: Agent) {
        swarmDao.insertAgent(agent)
    }

    suspend fun updateModel(model: AIModel) {
        swarmDao.insertModel(model)
    }

    suspend fun saveSettings(settings: AppSettings) {
        swarmDao.saveSettings(settings)
    }

    suspend fun recordBuild(prompt: String, swarmName: String, agentCount: Int, summary: String) {
        swarmDao.insertBuildHistory(
            BuildHistory(
                prompt = prompt,
                swarmName = swarmName,
                agentCount = agentCount,
                resultSummary = summary
            )
        )
    }
}
