package com.swarm.ai.data.model

data class AiModel(
    val id: String,
    val name: String,
    val description: String,
    val version: String,
    val sizeMb: Float,
    val isDownloaded: Boolean,
    val category: String,
    val badge: String? = null
)

enum class AgentStatus {
    RUNNING, PAUSED, IDLE, ERROR
}

data class Agent(
    val id: String,
    val name: String,
    val role: String,
    val status: AgentStatus,
    val workload: Float, // 0.0 to 1.0
    val accuracy: Float  // 0.0 to 1.0
)

data class UserPreferences(
    val selectedProvider: String = "OpenAI",
    val apiKey: String = "",
    val localInference: Boolean = true,
    val autoSync: Boolean = true,
    val maxThreads: Int = 4,
    val themeMode: String = "System"
)
