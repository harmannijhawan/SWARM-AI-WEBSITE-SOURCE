package com.swarm.ai.ui.companion

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.swarm.ai.remote.RemoteClient
import com.swarm.ai.remote.WsEvent
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject

data class AgentIdentity(val id: String, val name: String, val role: String)
// Names and descriptions match src/components/status.ts in the desktop application.
val desktopAgents = listOf(
    AgentIdentity("manager", "Manager", "Planning & orchestration"),
    AgentIdentity("planner", "Planner", "Task graph"),
    AgentIdentity("researcher", "Researcher", "Web research"),
    AgentIdentity("designer", "Designer", "UI/UX design"),
    AgentIdentity("architect", "Architect", "System architecture"),
    AgentIdentity("coder", "Coder", "Development"),
    AgentIdentity("tester", "Tester", "Testing & QA"),
    AgentIdentity("reviewer", "Reviewer", "Code & UX review"),
    AgentIdentity("optimizer", "Optimizer", "Performance"),
    AgentIdentity("vision", "Vision QA", "Visual inspection"),
    AgentIdentity("finalizer", "Finalizer", "Verification & delivery")
)
data class TeamMember(val identity: AgentIdentity, val status: String = "idle", val task: String = "", val activity: String = "", val model: String = "", val done: Int = 0, val total: Int = 0, val waitingFor: String = "", val error: String = "")
data class RunItem(val id: String, val objective: String, val status: String)
data class TaskItem(val id: String, val title: String, val role: String, val status: String, val output: String = "", val files: List<String> = emptyList())
data class ToolItem(val id: String, val tool: String, val label: String, val status: String, val detail: String = "", val preview: String = "")
data class ChatItem(val id: String, val text: String, val user: Boolean, val status: String, val detail: String = "", val tools: List<ToolItem> = emptyList(), val runId: String = "", val agent: String = "")
data class MobileApproval(val id: String, val title: String, val detail: String, val risk: String, val kind: String, val runId: String)
data class ConversationItem(val id: String, val title: String, val agentRole: String? = null, val runId: String = "")
data class CompanionState(
    val loading: Boolean = false,
    val runs: List<RunItem> = emptyList(),
    val runId: String = "",
    val runStatus: String = "",
    val objective: String = "",
    val summary: String = "",
    val tasks: List<TaskItem> = emptyList(),
    val team: List<TeamMember> = desktopAgents.map { TeamMember(it) },
    val activity: List<String> = emptyList(),
    val workEvents: List<WorkEvent> = emptyList(),
    val files: List<WorkFile> = emptyList(),
    val eventCursor: Long = 0,
    val awaySummary: String = "",
    val filePreview: FilePreview? = null,
    val previewLoading: Boolean = false,
    val prompt: String = "",
    val platform: String = "Web",
    val building: Boolean = false,
    val sending: Boolean = false,
    val chatId: String = "",
    val coordinatorChatId: String = "",
    val chatRole: String? = null,
    val chats: List<ConversationItem> = emptyList(),
    val messages: List<ChatItem> = emptyList(),
    val approvals: List<MobileApproval> = emptyList(),
    val computerActive: Boolean = false,
    val approvalBusy: String? = null,
    val error: String? = null,
    val motion: Boolean = true,
    val haptics: Boolean = true
)

internal fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
private fun JSONObject.value(key: String): String = if (isNull(key)) "" else optString(key)

internal fun parseChatTurn(o: JSONObject, agent: Boolean = false) = ChatItem(o.value("id"), o.value("text"), o.value(if (agent) "senderType" else "role") == "user", o.value("status"), o.value("error"),
    o.optJSONArray("activities").objects().map { ToolItem(it.value("id"), it.value("tool"), it.value("label"), it.value("status"), it.value("detail"), it.value("preview")) }, o.value("runId"), o.value("agent"))

internal fun mergeChatTurn(current: List<ChatItem>, incoming: ChatItem): List<ChatItem> {
    val previous = current.find { it.id == incoming.id }
    val turn = incoming.copy(tools = incoming.tools.map { tool -> if (tool.preview.isBlank()) tool.copy(preview = previous?.tools?.find { it.id == tool.id }?.preview.orEmpty()) else tool })
    val localUser = if (turn.user) current.firstOrNull { it.id.startsWith("local-") && it.user && it.text == turn.text }?.id else null
    val clean = current.filterNot { it.id == localUser || (!turn.user && it.id.endsWith("-thinking")) }
    return if (clean.any { it.id == turn.id }) clean.map { if (it.id == turn.id) turn else it } else clean + turn
}

@HiltViewModel
class CompanionViewModel @Inject constructor(
    private val api: CompanionApi,
    private val connection: RemoteClient,
    @ApplicationContext context: Context
) : ViewModel() {
    private val preferences = context.getSharedPreferences("companion-ui", Context.MODE_PRIVATE)
    private val savedCoordinator = preferences.getString("coordinator", "").orEmpty()
    private val _state = MutableStateFlow(CompanionState(motion = preferences.getBoolean("motion", true), haptics = preferences.getBoolean("haptics", true),
        chatId = savedCoordinator, coordinatorChatId = savedCoordinator,
        messages = runCatching { JSONArray(preferences.getString("conversation-cache", "[]")).objects().map { parseChatTurn(it) } }.getOrDefault(emptyList())))
    val state = _state.asStateFlow()
    private var polling: Job? = null
    private var eventsJob: Job? = null
    private val refreshLock = kotlinx.coroutines.sync.Mutex()
    private val chatCreateLock = kotlinx.coroutines.sync.Mutex()
    private var command: Job? = null
    private var sendJob: Job? = null
    private var cacheJob: Job? = null
    private var selection = 0
    private var chatSelection = 0
    private var chatRevision = 0
    private var sendSequence = 0
    private var replayCursor: Long? = preferences.getLong("away-cursor", -1).takeIf { it >= 0 }
    private var projectForDraft: Pair<String, String>? = null
    private var chatVisible = true
    private var awayCursor: Long? = preferences.getLong("away-cursor", -1).takeIf { it >= 0 }

    fun start() {
        if (polling?.isActive == true) return
        eventsJob = viewModelScope.launch {
            connection.events().filter { it !is WsEvent.DesktopFrame }.collect { event ->
                when (event) {
                    is WsEvent.AppUpdate -> when (event.channel) {
                        "chat:turn" -> (event.payload as? JSONObject)?.let { payload ->
                            if (payload.value("conversationId") == state.value.chatId) {
                                val turn = payload.optJSONObject("turn") ?: return@let
                                upsertTurn(parseChatTurn(turn))
                                val runId = payload.value("runId").ifBlank { turn.value("runId") }
                                if (runId.isNotBlank()) _state.update { it.copy(runId = runId) }
                            }
                        }
                        "workspace:event" -> (event.payload as? JSONObject)?.let { payload -> parseWorkEvent(payload)?.let(::receiveWorkEvent) }
                        "approvals:changed" -> setApprovals(event.payload as? JSONArray)
                        "computer:activity" -> (event.payload as? JSONObject)?.let { payload -> _state.update { it.copy(computerActive = payload.optBoolean("controlling")) } }
                    }
                    is WsEvent.Approvals -> setApprovals(JSONArray(event.approvals))
                    is WsEvent.Activity -> {
                        if (event.event.value("runId") == state.value.runId) {
                            val role = event.event.value("agent")
                            val message = event.event.value("message")
                            val agent = event.event.optJSONObject("agentState")
                            val task = event.event.optJSONObject("task")
                            _state.update { s ->
                                val tasks = if (task == null) s.tasks else {
                                    val updated = TaskItem(task.value("id"), task.value("title"), task.value("role"), task.value("status"), task.value("error").ifBlank { task.value("output") })
                                    if (s.tasks.any { it.id == updated.id }) s.tasks.map { if (it.id == updated.id) updated else it } else s.tasks + updated
                                }
                                s.copy(tasks = tasks, team = s.team.map { member -> if (member.identity.id == role) {
                                    val assigned = tasks.filter { it.role == role }
                                    member.copy(status = agent?.value("status")?.ifBlank { member.status } ?: member.status,
                                        task = agent?.value("taskTitle")?.ifBlank { member.task } ?: member.task,
                                        activity = agent?.value("lastAction")?.ifBlank { message } ?: message,
                                        done = assigned.count { it.status == "completed" }, total = assigned.size,
                                        error = if (task?.value("status") == "failed") task.value("error") else member.error)
                                } else member }, activity = (listOf(message) + s.activity).distinct().take(12))
                            }
                        }
                    }
                    else -> Unit
                }
            }
        }
        polling = viewModelScope.launch {
            _state.update { it.copy(loading = true) }
            while (isActive && connection.isPaired) {
                try { refreshData() } catch (e: CancellationException) { throw e }
                catch (e: Exception) { _state.update { it.copy(error = e.message, loading = false) } }
                delay(if (connection.socketConnected.value) 10000 else 2500)
            }
        }
    }
    fun stop() { visible(false); polling?.cancel(); polling = null; eventsJob?.cancel(); eventsJob = null }
    fun visible(value: Boolean) {
        if (!value && chatVisible && state.value.eventCursor > 0) {
            awayCursor = state.value.eventCursor
            preferences.edit().putLong("away-cursor", awayCursor!!).apply()
        }
        chatVisible = value
        if (value) summarizeAway()
    }
    private fun summarizeAway() {
        val cursor = awayCursor ?: return
        val missed = state.value.workEvents.filter { it.sequence > cursor }
        if (missed.isNotEmpty()) {
            _state.update { it.copy(awaySummary = workSummary(missed, it.approvals.size)) }
            awayCursor = null
            preferences.edit().remove("away-cursor").apply()
        }
    }
    fun dismissAway() { _state.update { it.copy(awaySummary = "") } }
    fun clear() {
        stop(); command?.cancel(); sendJob?.cancel(); selection++; chatSelection++; projectForDraft = null
        preferences.edit().remove("coordinator").remove("conversation-cache").remove("away-cursor").apply()
        awayCursor = null; replayCursor = null; sendSequence++
        _state.update { CompanionState(motion = it.motion, haptics = it.haptics) }
    }
    fun dismissError() { _state.update { it.copy(error = null) } }
    fun prompt(value: String) { _state.update { it.copy(prompt = value.take(7800)) } }
    fun platform(value: String) { _state.update { it.copy(platform = value) } }
    fun preference(motion: Boolean = state.value.motion, haptics: Boolean = state.value.haptics) {
        preferences.edit().putBoolean("motion", motion).putBoolean("haptics", haptics).apply()
        _state.update { it.copy(motion = motion, haptics = haptics) }
    }
    fun selectRun(id: String) {
        selection++; replayCursor = null
        _state.update { it.copy(runId = id, runStatus = "", objective = "", summary = "", activity = emptyList(), workEvents = emptyList(), files = emptyList(), eventCursor = 0, tasks = emptyList(), team = desktopAgents.map { a -> TeamMember(a) }) }
        refreshSoon()
    }
    fun selectChat(id: String = "", role: String? = null) {
        chatSelection++; selection++; replayCursor = null
        val previous = state.value
        val chosen = if (id.isNotBlank()) previous.chats.find { it.id == id } else if (role != null) previous.chats.firstOrNull { it.agentRole == role && it.runId == previous.runId } else null
        val selectedId = chosen?.id ?: id
        val selectedRole = role ?: chosen?.agentRole
        _state.update { it.copy(chatId = selectedId, chatRole = selectedRole, messages = emptyList(), workEvents = emptyList(), files = emptyList(), eventCursor = 0, awaySummary = "", sending = false,
            runId = chosen?.runId ?: if (selectedRole != null) it.runId else "") }
        if (selectedRole == null) {
            preferences.edit().putString("coordinator", selectedId).putString("conversation-cache", "[]").apply()
            _state.update { it.copy(coordinatorChatId = selectedId) }
        }
        refreshSoon()
    }

    private fun refreshSoon() { viewModelScope.launch { try { refreshData() } catch (e: CancellationException) { throw e } catch (e: Exception) { _state.update { it.copy(error = e.message, loading = false) } } } }

    private suspend fun refreshData() = refreshLock.withLock {
        val version = selection
        val runs = (api.invoke("runs:list") as? JSONArray).objects().map { RunItem(it.value("id"), it.value("objective"), it.value("status")) }
        if (version != selection) return@withLock
        _state.update { it.copy(runs = runs) }
        refreshChat()
        if (version != selection) return@withLock
        val selected = state.value.runId
        val snapshot = if (selected.isNotBlank()) api.invoke("runs:snapshot", selected) as? JSONObject else null
        val run = snapshot?.optJSONObject("run")
        val agents = snapshot?.optJSONArray("agents").objects()
        val tasks = snapshot?.optJSONArray("tasks").objects().map { t ->
            val files = t.optJSONArray("filesTouched")
            TaskItem(t.value("id"), t.value("title"), t.value("role"), t.value("status"), t.value("error").ifBlank { t.value("output") },
                if (files == null) emptyList() else (0 until files.length()).map { files.optString(it) })
        }
        if (version != selection || selected != state.value.runId) return@withLock
        _state.update { s -> s.copy(loading = false, runs = runs, runId = selected,
            runStatus = run?.value("status") ?: "", objective = run?.value("objective") ?: "", summary = run?.value("summary") ?: "",
            tasks = tasks, team = if (snapshot == null) s.team else desktopAgents.map { identity ->
                val agent = agents.firstOrNull { it.value("role") == identity.id }
                val assigned = tasks.filter { it.role == identity.id }
                val failed = assigned.lastOrNull { it.status == "failed" || it.status == "blocked" }
                TeamMember(identity, agent?.value("status") ?: "idle", agent?.value("taskTitle") ?: "", agent?.value("lastAction") ?: "", agent?.value("modelId") ?: "",
                    assigned.count { it.status == "completed" }, assigned.size, if (agent?.value("status") == "waiting") "Task dependencies or approval" else "", failed?.output ?: "")
            }) }
        refreshWorkspace(version)
        if (chatVisible) summarizeAway()
    }

    private suspend fun refreshChat() {
        val version = chatSelection
        val revision = chatRevision
        val s = state.value
        val chats = (api.invoke("chat:list") as? JSONArray).objects().map { ConversationItem(it.value("id"), it.value("title"), it.value("agentRole").takeIf { role -> role.isNotBlank() }, it.value("runId")) }
        val conversation = if (s.chatId.isNotBlank()) api.invoke("chat:get", s.chatId) as? JSONObject else null
        if (version == chatSelection) _state.update { it.copy(chats = chats, runId = conversation?.value("runId")?.ifBlank { it.runId } ?: it.runId,
            messages = if (conversation == null || it.sending || revision != chatRevision) it.messages else conversation.optJSONArray("turns").objects().map { turn -> parseChatTurn(turn) }) }
        cacheConversation()
    }

    private suspend fun refreshWorkspace(version: Int) {
        val s = state.value
        val request = JSONObject().put("limit", 300)
        replayCursor?.let { request.put("after", it) }
        if (s.chatId.isNotBlank()) request.put("conversationId", s.chatId)
        if (s.runId.isNotBlank()) request.put("runId", s.runId)
        val snapshot = api.invoke("workspace:snapshot", request) as? JSONObject ?: return
        if (version != selection) return
        replayCursor = snapshot.optLong("cursor")
        val incoming = snapshot.optJSONArray("events").objects().mapNotNull(::parseWorkEvent)
        _state.update { old -> old.copy(workEvents = mergeWorkEvents(old.workEvents, incoming), eventCursor = maxOf(old.eventCursor, snapshot.optLong("cursor")),
            files = (snapshot.optJSONArray("files").objects().map(::parseWorkFile) + old.files).distinctBy { it.id }.sortedByDescending { it.timestamp }) }
        if (snapshot.has("approvals")) setApprovals(snapshot.optJSONArray("approvals"))
        if (snapshot.optBoolean("hasMore")) refreshWorkspace(version)
    }

    private fun receiveWorkEvent(event: WorkEvent) {
        val s = state.value
        if (event.conversationId.isNotBlank() && event.conversationId != s.chatId && event.runId != s.runId && event.runId != s.chatId) return
        if (event.runId.isNotBlank() && event.runId != s.runId && event.runId != s.chatId && event.conversationId != s.chatId) return
        _state.update { old ->
            val file = if (event.type.startsWith("file_") && event.path.isNotBlank()) WorkFile(event.changeId.ifBlank { event.id }, event.path, event.type.removePrefix("file_"), event.agent, event.additions, event.deletions, event.timestamp.toLongOrNull() ?: 0) else null
            old.copy(workEvents = mergeWorkEvents(old.workEvents, listOf(event)), eventCursor = maxOf(old.eventCursor, event.sequence),
                activity = (listOf(event.message) + old.activity).filter { it.isNotBlank() }.distinct().take(12),
                files = if (file == null) old.files else old.files.filterNot { it.path == file.path } + file,
                tasks = event.task?.let { task -> if (old.tasks.any { it.id == task.id }) old.tasks.map { if (it.id == task.id) task else it } else old.tasks + task } ?: old.tasks,
                team = old.team.map { member -> if (member.identity.id == event.agent) member.copy(activity = event.message, task = event.agentTask.ifBlank { event.task?.title.orEmpty().ifBlank { member.task } },
                    status = when { event.agentStatus.isNotBlank() -> event.agentStatus; event.type == "task_failed" -> "failed"; event.type == "task_completed" -> "done"; event.type.endsWith("started") -> "working"; else -> member.status }) else member },
                runStatus = when (event.type) { "run_started", "run_resumed" -> "running"; "run_completed" -> "completed"; "run_failed" -> "failed"; "run_paused" -> "paused"; "run_stopped" -> "cancelled"; else -> old.runStatus },
                runId = event.runId.takeIf { it.isNotBlank() && it != old.chatId } ?: old.runId, computerActive = if (event.type == "computer_started") true else old.computerActive)
        }
    }

    private fun cacheConversation() {
        cacheJob?.cancel()
        cacheJob = viewModelScope.launch { delay(350); persistConversation() }
    }
    private fun persistConversation() {
        val s = state.value
        if (s.chatRole != null || s.chatId.isBlank()) return
        val turns = JSONArray(s.messages.filterNot { it.id.startsWith("local-") }.takeLast(100).map { turn ->
            JSONObject().put("id", turn.id).put("text", turn.text).put("role", if (turn.user) "user" else "assistant").put("status", turn.status).put("runId", turn.runId).put("agent", turn.agent)
                .put("activities", JSONArray(turn.tools.map { JSONObject().put("id", it.id).put("tool", it.tool).put("label", it.label).put("status", it.status).put("detail", it.detail) }))
        })
        preferences.edit().putString("conversation-cache", turns.toString()).apply()
    }

    fun previewFile(file: WorkFile) {
        if (file.id.isBlank()) return
        _state.update { it.copy(previewLoading = true, filePreview = null) }
        viewModelScope.launch {
            try {
                val result = api.invoke("workspace:file", file.id) as? JSONObject ?: error("File change is unavailable")
                _state.update { it.copy(filePreview = FilePreview(result.value("path").ifBlank { file.path }, result.value("diff"), result.optBoolean("truncated"))) }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { _state.update { it.copy(error = e.message) } }
            finally { _state.update { it.copy(previewLoading = false) } }
        }
    }
    fun closePreview() { _state.update { it.copy(filePreview = null) } }

    fun build() {
        val s = state.value
        if (s.building || s.prompt.isBlank()) return
        send("Build the requested ${s.platform} application.\n\n${s.prompt.trim()}")
        _state.update { it.copy(prompt = "") }
    }
    fun control(action: String) {
        val id = state.value.runId
        if (id.isBlank() || state.value.building) return
        _state.update { it.copy(building = true) }
        command = viewModelScope.launch {
            try { api.invoke("runs:$action", id); stop(); start() }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { _state.update { it.copy(error = e.message) } }
            finally { _state.update { it.copy(building = false) } }
        }
    }
    fun send(text: String, attachments: List<Pair<String, String>> = emptyList()) {
        val s = state.value
        if (text.isBlank()) return
        val sendVersion = ++sendSequence
        val version = chatSelection
        val optimistic = "local-${System.nanoTime()}"
        _state.update { it.copy(sending = true, error = null, messages = it.messages.filterNot { message -> message.id.endsWith("-thinking") } + ChatItem(optimistic, text, true, "sending") + ChatItem("$optimistic-thinking", "", false, "streaming")) }
        sendJob = viewModelScope.launch {
            try {
                    val id = chatCreateLock.withLock { s.chatId.ifBlank {
                        if (version == chatSelection && state.value.chatId.isNotBlank()) return@withLock state.value.chatId
                        val options = JSONObject()
                        if (s.chatRole != null) options.put("agentRole", s.chatRole)
                        if (s.runId.isNotBlank()) options.put("runId", s.runId)
                        (api.invoke("chat:new", options) as JSONObject).getString("id").also { created ->
                            if (version == chatSelection) _state.update { it.copy(chatId = created) }
                        }
                    } }
                    if (version == chatSelection) {
                        _state.update { it.copy(chatId = id, coordinatorChatId = if (s.chatRole == null) id else it.coordinatorChatId) }
                        if (s.chatRole == null) preferences.edit().putString("coordinator", id).apply()
                    }
                    val request = JSONObject().put("id", id).put("text", text.take(8000))
                    if (attachments.isNotEmpty()) request.put("attachments", JSONArray(attachments.take(5).map { (name, content) -> JSONObject().put("name", name).put("text", content) }))
                    val result = api.invoke("chat:send", request) as? JSONObject
                    if (version == chatSelection && sendVersion == sendSequence && result != null) { _state.update { it.copy(messages = result.optJSONArray("turns").objects().map { turn -> parseChatTurn(turn) }, runId = result.value("runId").ifBlank { it.runId }) }; cacheConversation(); refreshData() }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (version == chatSelection && sendVersion == sendSequence) _state.update { it.copy(error = e.message, messages = it.messages.filterNot { message -> message.id == "$optimistic-thinking" }.map { message -> if (message.id == optimistic) message.copy(status = "error", detail = "${e.message} The request may have reached your PC; check history before retrying.") else message }) } }
            finally { if (version == chatSelection && sendVersion == sendSequence) _state.update { it.copy(sending = false) } }
        }
    }

    private fun upsertTurn(turn: ChatItem) { chatRevision++; _state.update { it.copy(messages = mergeChatTurn(it.messages, turn)) }; cacheConversation() }
    private fun setApprovals(array: JSONArray?) { _state.update { it.copy(approvals = array.objects().map { a -> MobileApproval(a.value("id"), a.value("title"), a.value("detail"), a.value("risk"), a.value("kind"), a.value("runId")) }) } }
    fun resolveApproval(id: String, approved: Boolean) {
        if (state.value.approvalBusy != null) return
        _state.update { it.copy(approvalBusy = id) }
        viewModelScope.launch {
            try { api.invoke("approvals:resolve", id, approved, JSONObject().put("confirm", true)); _state.update { it.copy(approvals = it.approvals.filterNot { a -> a.id == id }) } }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { _state.update { it.copy(error = e.message) } }
            finally { _state.update { it.copy(approvalBusy = null) } }
        }
    }
    fun stopResponse() {
        val s = state.value
        viewModelScope.launch {
            try { if (s.chatId.isNotBlank()) api.invoke("chat:stop", s.chatId) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { _state.update { it.copy(error = e.message) } }
        }
    }
}
