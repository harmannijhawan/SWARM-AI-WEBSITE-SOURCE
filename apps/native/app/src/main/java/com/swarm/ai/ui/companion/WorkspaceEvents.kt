package com.swarm.ai.ui.companion

import org.json.JSONObject

/** Safe, persisted events from the desktop workspace bus. No model reasoning is rendered. */
data class WorkEvent(
    val id: String,
    val sequence: Long,
    val type: String,
    val timestamp: String,
    val conversationId: String = "",
    val runId: String = "",
    val agent: String = "",
    val message: String = "",
    val status: String = "",
    val path: String = "",
    val tool: String = "",
    val command: String = "",
    val detail: String = "",
    val changeId: String = "",
    val additions: Int? = null,
    val deletions: Int? = null,
    val agentStatus: String = "",
    val agentTask: String = "",
    val task: TaskItem? = null,
    val operationId: String = ""
)

data class WorkFile(val id: String, val path: String, val kind: String, val agent: String = "", val additions: Int? = null, val deletions: Int? = null, val timestamp: Long = 0)
data class FilePreview(val path: String, val diff: String, val truncated: Boolean = false)

internal fun JSONObject.stringValue(key: String): String = if (isNull(key)) "" else optString(key)
private fun JSONObject.optionalCount(key: String): Int? = if (!has(key) || isNull(key)) null else optInt(key).takeIf { it >= 0 }

internal val visibleWorkTypes = setOf(
    "message", "assistant_message", "agent_started", "agent_status", "agent_message",
    "task_started", "task_progress", "tool_started", "tool_finished", "computer_started",
    "computer_action", "computer_observation", "file_created", "file_modified", "file_deleted",
    "command_started", "command_finished", "search_started", "search_finished", "approval_required",
    "task_completed", "task_failed", "approval_resolved", "run_started", "run_completed", "run_failed",
    "run_paused", "run_resumed", "run_stopped", "notification"
)

internal fun parseWorkEvent(json: JSONObject): WorkEvent? {
    val type = json.stringValue("type")
    if (type !in visibleWorkTypes || json.stringValue("id").isBlank()) return null
    val data = json.optJSONObject("data") ?: JSONObject()
    val agent = data.optJSONObject("agent")
    val task = data.optJSONObject("task")
    return WorkEvent(json.stringValue("id"), json.optLong("sequence"), type, json.stringValue("ts"),
        json.stringValue("conversationId"), json.stringValue("runId"), json.stringValue("agent"),
        json.stringValue("message"), json.stringValue("status"), data.stringValue("path"),
        data.stringValue("tool"), data.stringValue("command"),
        data.stringValue("detail").ifBlank { data.stringValue("summary") }.ifBlank { data.stringValue("output") }.ifBlank { data.stringValue("query") }.take(12000),
        data.stringValue("changeId").ifBlank { data.stringValue("fileChangeId") },
        data.optionalCount("additions"), data.optionalCount("deletions"), agent?.stringValue("status").orEmpty(), agent?.stringValue("taskTitle").orEmpty(),
        task?.let { TaskItem(it.stringValue("id"), it.stringValue("title"), it.stringValue("role"), it.stringValue("status"), it.stringValue("error")) },
        data.stringValue("commandId").ifBlank { data.stringValue("activityId") }.ifBlank { json.stringValue("taskId") })
}

internal fun parseWorkFile(json: JSONObject) = WorkFile(json.stringValue("id"), json.stringValue("path"),
    json.stringValue("kind"), json.stringValue("agent"), json.optionalCount("additions"), json.optionalCount("deletions"), json.optLong("ts"))

/** Replay and live delivery may overlap. Event identity prevents duplicate cards and summaries. */
internal fun mergeWorkEvents(current: List<WorkEvent>, incoming: List<WorkEvent>): List<WorkEvent> =
    (current + incoming).groupBy { it.id }.values.map { values -> values.maxBy { it.sequence } }.sortedBy { it.sequence }.takeLast(300)

internal fun workActivity(events: List<WorkEvent>): List<WorkEvent> = events
    .filter { it.type !in setOf("message", "assistant_message", "agent_message", "agent_status") }
    .groupBy { event -> if (event.operationId.isBlank()) event.id else event.type.substringBefore('_') + ":" + event.operationId }
    .values.map { values -> values.maxBy { it.sequence } }.sortedByDescending { it.sequence }

internal fun workSummary(events: List<WorkEvent>, approvals: Int): String {
    val changes = events.filter { it.type.startsWith("file_") }.map { it.path.ifBlank { it.changeId.ifBlank { it.id } } }.distinct().size
    val completed = events.count { it.type == "task_completed" }
    val failures = events.count { it.type == "task_failed" }
    val commands = events.count { it.type == "command_finished" }
    return listOfNotNull(
        changes.takeIf { it > 0 }?.let { "$it ${if (it == 1) "file changed" else "files changed"}" },
        completed.takeIf { it > 0 }?.let { "$it ${if (it == 1) "task completed" else "tasks completed"}" },
        commands.takeIf { it > 0 }?.let { "$it ${if (it == 1) "command finished" else "commands finished"}" },
        failures.takeIf { it > 0 }?.let { "$it ${if (it == 1) "task needs attention" else "tasks need attention"}" },
        approvals.takeIf { it > 0 }?.let { "$it ${if (it == 1) "approval waiting" else "approvals waiting"}" }
    ).joinToString(" · ").ifBlank { events.lastOrNull()?.message.orEmpty() }
}
