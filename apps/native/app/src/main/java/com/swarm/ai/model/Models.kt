package com.swarm.ai.model

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "agents")
data class Agent(
    @PrimaryKey val id: String,
    val name: String,
    val role: String,
    val status: String, // "Active", "Idle", "Busy"
    val model: String = "",
    val performance: Float = 0f,
    val tasksCompleted: Int = 0,
    val specialty: String = "",
    val currentTask: String? = null
)

@Entity(tableName = "ai_models")
data class AIModel(
    @PrimaryKey val id: String,
    val name: String,
    val provider: String,
    val size: String,
    val status: String = "Available", // "Downloaded", "Available", "Downloading"
    val quantization: String = "",
    val isDefault: Boolean = false,
    val downloaded: Boolean = status == "Downloaded"
)

/** Alias used by the UI layer and tests. */
typealias AiModel = AIModel

@Entity(tableName = "settings")
data class AppSettings(
    @PrimaryKey val id: Int = 1,
    val themeMode: String = "System", // "Dark", "Light", "System"
    val activeProvider: String = "Local TFLite",
    val localInferenceEnabled: Boolean = true,
    val maxThreads: Int = 4,
    val telemetryEnabled: Boolean = false,
    val selectedModelId: String = "",
    val temperature: Float = 0.7f,
    val maxTokens: Int = 2048,
    val ollamaEndpoint: String = "http://localhost:11434"
)

/** Alias used by the UI layer and tests. */
typealias SwarmSettings = AppSettings

@Entity(tableName = "build_history")
data class BuildHistory(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val prompt: String,
    val swarmName: String,
    val agentCount: Int,
    val timestamp: Long = System.currentTimeMillis(),
    val resultSummary: String
)
