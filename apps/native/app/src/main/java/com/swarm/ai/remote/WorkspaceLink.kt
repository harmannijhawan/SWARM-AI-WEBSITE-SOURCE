package com.swarm.ai.remote

import org.json.JSONObject

/** Persisted notification target; identifiers point to the authoritative PC conversation/task. */
data class WorkspaceLink(
    val id: String,
    val eventType: String,
    val conversationId: String? = null,
    val runId: String? = null,
    val agentRole: String? = null,
    val approvalId: String? = null
) {
    fun toJson(): String = JSONObject().put("id", id).put("eventType", eventType)
        .put("conversationId", conversationId).put("runId", runId).put("agentRole", agentRole)
        .put("approvalId", approvalId).toString()

    companion object {
        fun parse(raw: String?): WorkspaceLink? = try {
            if (raw == null) null else {
                val json = JSONObject(raw)
                fun value(key: String) = if (json.isNull(key)) null else json.optString(key).takeIf { it.isNotBlank() }
                val id = value("id")
                val type = value("eventType")
                if (id == null || type == null) null else WorkspaceLink(id, type, value("conversationId"), value("runId"), value("agentRole"), value("approvalId"))
            }
        } catch (_: Exception) { null }
    }
}

data class WorkNotification(val title: String, val body: String, val target: WorkspaceLink)

/** No notification for routine work or individual successful substeps. */
fun workNotification(event: JSONObject): WorkNotification? {
    val type = event.optString("type")
    val data = event.optJSONObject("data")
    val source = data?.optString("sourceType").orEmpty()
    val title = when {
        type == "approval_required" -> "SWARM needs your approval"
        type == "run_completed" || type == "task_completed" && source == "RUN_COMPLETED" -> "SWARM finished your task"
        type == "run_failed" || type == "task_failed" -> "SWARM needs attention"
        type == "agent_status" && (event.optString("status") == "blocked" || data?.optJSONObject("agent")?.optString("status") == "blocked") -> "An agent needs your input"
        else -> return null
    }
    fun value(key: String) = if (event.isNull(key)) null else event.optString(key).takeIf { it.isNotBlank() }
    val id = value("id") ?: return null
    return WorkNotification(title, event.optString("message").take(1200), WorkspaceLink(
        id, type, value("conversationId"), value("runId"), value("agent"),
        data?.optString("approvalId")?.takeIf { it.isNotBlank() }
    ))
}
