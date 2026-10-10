package com.swarm.ai.ui.companion

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.launch
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

val suggestions = listOf("Build a modern landing page with smooth animations", "Create a desktop app for file management", "Build an Android app with authentication")

@Composable
fun BuildPage(state: CompanionState, online: Boolean, onPrompt: (String) -> Unit, onPlatform: (String) -> Unit, onBuild: () -> Unit, onControl: (String) -> Unit, onRuns: () -> Unit, onAgent: (TeamMember) -> Unit) {
    var mode by rememberSaveable { mutableStateOf("Build") }
    var composing by rememberSaveable { mutableStateOf(false) }
    var cancel by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(state.prompt) { if (state.prompt.isNotBlank()) composing = true }
    LaunchedEffect(state.runId) { if (state.runId.isNotBlank() && state.prompt.isBlank()) composing = false }
    val execution = state.runId.isNotBlank() && !composing
    LazyColumn(Modifier.fillMaxSize().imePadding().testTag("build-list"), contentPadding = PaddingValues(22.dp, 8.dp, 22.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item { Segments(listOf("Build", "Templates"), mode) { mode = it; if (it == "Templates") composing = true } }
        if (!execution || mode == "Templates") {
            item { PageTitle("What should\nSWARM build?", "Describe the outcome. Your swarm will plan, build, and verify it on your PC.") }
            item { SoftCard {
                OutlinedTextField(state.prompt, onPrompt, Modifier.fillMaxWidth().heightIn(min = 170.dp), placeholder = { Text("Tell the swarm what you want to build…", color = Muted, fontSize = 14.sp) }, minLines = 5, maxLines = 9, shape = RoundedCornerShape(18.dp), colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = Color.Transparent, focusedBorderColor = Line))
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                    Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Rounded.AutoAwesome, null, Modifier.size(16.dp), tint = Blue); Text("  Auto · best agents for the job", fontSize = 11.sp, color = Muted) }
                    Text("${state.prompt.length}/7800", fontSize = 10.sp, color = Muted)
                }
            } }
            item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                listOf("Web", "Windows", "Android", "CLI").forEach { platform ->
                    Surface(onClick = { onPlatform(platform) }, modifier = Modifier.weight(1f).heightIn(min = 46.dp),
                        shape = RoundedCornerShape(12.dp), color = if (state.platform == platform) Color(0xFFE6EDFF) else Color(0xFFF0F3FB),
                        border = BorderStroke(1.dp, if (state.platform == platform) Blue.copy(alpha = .5f) else Line)) {
                        Box(contentAlignment = Alignment.Center) { Text(platform, fontSize = 11.sp, maxLines = 1, color = if (state.platform == platform) Blue else Muted) }
                    }
                }
            } }
            item { PrimaryAction("Build with SWARM", online && state.prompt.isNotBlank(), state.building) { mode = "Build"; onBuild() } }
            if (!online) item { Text("Reconnect to your PC to start a build.", color = Muted, fontSize = 12.sp) }
            item { SectionTitle("${if (mode == "Templates") "Start with an idea" else "Suggested prompts"}") }
            items(suggestions) { suggestion ->
                SoftCard(Modifier.clickable { onPrompt(suggestion); mode = "Build" }, color = Color(0xFFF1F4FC)) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) { Icon(Icons.Rounded.AutoAwesome, null, Modifier.size(18.dp), tint = Muted); Text(suggestion, Modifier.weight(1f), fontSize = 12.sp, lineHeight = 18.sp); Icon(Icons.Rounded.ChevronRight, null, tint = Muted) }
                }
            }
            if (state.runId.isNotBlank()) item { TextButton(onClick = { composing = false; mode = "Build" }) { Text("Return to current build") } }
        } else {
            item { Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.weight(1f)) { PageTitle(if (state.runStatus == "completed") "Built together." else "Your swarm at work") }; IconButton(onClick = { composing = true }) { Icon(Icons.Rounded.Add, "New build") } } }
            item { SoftCard {
                StatusPill(state.runStatus.ifBlank { "Loading" })
                Text(state.objective, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 5, overflow = TextOverflow.Ellipsis)
                val done = state.tasks.count { it.status == "completed" }
                val progress by animateFloatAsState(if (state.tasks.isEmpty()) 0f else done.toFloat() / state.tasks.size, label = "build progress")
                LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth().height(6.dp).clip(CircleShape), trackColor = Line)
                Text("$done of ${state.tasks.size} tasks completed", color = Muted, fontSize = 12.sp)
                if (state.runStatus == "running" || state.runStatus == "paused") Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { onControl(if (state.runStatus == "paused") "resume" else "pause") }, enabled = online && !state.building) { Icon(if (state.runStatus == "paused") Icons.Rounded.PlayArrow else Icons.Rounded.Pause, null, Modifier.size(17.dp)); Text(if (state.runStatus == "paused") "Resume" else "Pause") }
                    TextButton(onClick = { cancel = true }, enabled = online && !state.building) { Text("Stop build", color = MaterialTheme.colorScheme.error) }
                }
            } }
            item { LazyRow(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                items(state.team.filter { it.task.isNotBlank() || it.status != "idle" }.ifEmpty { state.team.take(4) }, key = { it.identity.id }) { member ->
                    Column(Modifier.width(72.dp).clip(RoundedCornerShape(16.dp)).clickable { onAgent(member) }.padding(vertical = 5.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        AgentAvatar(desktopAgents.indexOf(member.identity), active = member.status in listOf("working", "planning"))
                        Text(member.identity.name, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                        Text(member.status, color = Muted, fontSize = 10.sp)
                    }
                }
            } }
            item { SectionTitle("Execution plan") }
            if (state.tasks.isEmpty()) item { SoftCard { Text("Waiting for the desktop’s plan", fontWeight = FontWeight.SemiBold); Text("Tasks appear here as Manager and Planner create them.", color = Muted, fontSize = 13.sp) } }
            items(state.tasks, key = { it.id }) { task ->
                var expanded by rememberSaveable(task.id) { mutableStateOf(false) }
                SoftCard(Modifier.animateContentSize().clickable { expanded = !expanded }) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(when (task.status) { "completed" -> Icons.Rounded.CheckCircle; "running" -> Icons.Rounded.PlayCircle; "failed", "blocked" -> Icons.Rounded.ErrorOutline; else -> Icons.Rounded.RadioButtonUnchecked }, null, tint = when (task.status) { "completed" -> Color(0xFF20AF75); "running" -> Blue; else -> Muted }, modifier = Modifier.size(22.dp))
                        Column(Modifier.weight(1f)) { Text(task.title, fontSize = 13.sp, fontWeight = FontWeight.Medium); Text("${desktopAgents.find { it.id == task.role }?.name ?: task.role} · ${task.status}", color = Muted, fontSize = 11.sp) }
                        Icon(if (expanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore, "Task details", tint = Muted)
                    }
                    if (expanded) { SelectionContainer { Text(task.output.ifBlank { "No result yet." }, fontSize = 12.sp, color = Muted) }; task.files.take(10).forEach { Text("↳ $it", fontSize = 11.sp, color = Blue) } }
                }
            }
            if (state.summary.isNotBlank()) item { SoftCard(color = Color(0xFFE9F8F1)) { Text("Build result", fontWeight = FontWeight.Bold); SelectionContainer { Text(state.summary, fontSize = 13.sp) } } }
        }
        item { TextButton(onClick = onRuns, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Rounded.History, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Previous builds") } }
    }
    if (cancel) AlertDialog(onDismissRequest = { cancel = false }, title = { Text("Stop this build?") }, text = { Text("The desktop will cancel the active run. Work already saved stays on your PC.") }, confirmButton = { TextButton(onClick = { cancel = false; onControl("cancel") }) { Text("Stop build") } }, dismissButton = { TextButton(onClick = { cancel = false }) { Text("Keep building") } })
}

@Composable
fun ChatPage(state: CompanionState, online: Boolean, onSend: (String) -> Unit, onStop: () -> Unit, onHistory: () -> Unit, onNew: () -> Unit, onAgents: () -> Unit, onBuild: (String) -> Unit,
    onRemote: () -> Unit = {}, onApproval: (String) -> Unit = {}, onSendFiles: (String, List<Pair<String, String>>) -> Unit = { text, _ -> onSend(text) },
    onWork: () -> Unit = {}, onCoordinator: () -> Unit = {}, onDismissAway: () -> Unit = {}) {
    var draft by rememberSaveable(state.chatId, state.chatRole) { mutableStateOf("") }
    var attachments by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    var attachmentError by remember { mutableStateOf<String?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    val pickFile = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            try {
                val file = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    val name = context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else "attachment.txt" } ?: "attachment.txt"
                    val bytes = context.contentResolver.openInputStream(uri)?.use { val out = java.io.ByteArrayOutputStream(); val buffer = ByteArray(4096); while (out.size() <= 16000) { val read = it.read(buffer, 0, minOf(buffer.size, 16001 - out.size())); if (read <= 0) break; out.write(buffer, 0, read) }; out.toByteArray() } ?: error("Cannot read this file")
                    require(bytes.size <= 16000) { "Choose a text file up to 16 KB." }
                    require(!bytes.contains(0.toByte())) { "This composer supports text and code files." }
                    name to bytes.toString(Charsets.UTF_8)
                }
                if (attachments.size >= 5 || attachments.sumOf { it.second.length } + file.second.length > 40000) error("Attachments are limited to 5 files and 40 KB per message.")
                attachments = attachments + file; attachmentError = null
            } catch (e: kotlinx.coroutines.CancellationException) { throw e }
            catch (e: Exception) { attachmentError = e.message }
        }
    }
    val voice = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == android.app.Activity.RESULT_OK) result.data?.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let { draft = (draft + " " + it).trim().take(8000) }
    }
    val voiceIntent = remember { android.content.Intent(android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL, android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, "Ask SWARM anything") }
    val voiceAvailable = remember { voiceIntent.resolveActivity(context.packageManager) != null }
    val list = rememberLazyListState()
    val streaming = state.messages.any { it.status == "streaming" }
    LaunchedEffect(state.messages.lastOrNull()?.text, state.messages.size, state.messages.lastOrNull()?.tools) {
        if (state.messages.isNotEmpty() && list.layoutInfo.visibleItemsInfo.lastOrNull()?.index.let { it == null || it >= list.layoutInfo.totalItemsCount - 3 }) {
            withFrameNanos { }
            list.scrollToItem((list.layoutInfo.totalItemsCount - 1).coerceAtLeast(0))
        }
    }
    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.padding(horizontal = 18.dp), verticalAlignment = Alignment.CenterVertically) {
            if (state.chatRole != null) IconButton(onClick = onCoordinator, modifier = Modifier.size(34.dp)) { Icon(Icons.Rounded.ArrowBack, "Return to SWARM coordinator", Modifier.size(20.dp), tint = Blue) }
            Column(Modifier.weight(1f)) {
                Text(state.chatRole?.let { role -> desktopAgents.find { it.id == role }?.name } ?: "SWARM", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                Text(state.chatRole?.let { role -> desktopAgents.find { it.id == role }?.role } ?: if (online) "Your coordinator · connected to your PC" else "Your coordinator · reconnecting", fontSize = 10.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            IconButton(onClick = onRemote, modifier = Modifier.size(38.dp)) { Icon(Icons.Rounded.DesktopWindows, "View live PC", tint = Blue, modifier = Modifier.size(20.dp)) }
            IconButton(onClick = onHistory, modifier = Modifier.size(38.dp)) { Icon(Icons.Rounded.History, "Conversation history", tint = Muted, modifier = Modifier.size(20.dp)) }
            IconButton(onClick = onNew, modifier = Modifier.size(38.dp)) { Icon(Icons.Rounded.Add, "New conversation", tint = Muted, modifier = Modifier.size(20.dp)) }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("chat-messages"), state = list, contentPadding = PaddingValues(18.dp, 14.dp, 18.dp, 14.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            if (state.awaySummary.isNotBlank()) item(key = "while-away") {
                Surface(color = Color(0xFFF0F3FA), shape = RoundedCornerShape(16.dp)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) { Text("While you were away", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f)); IconButton(onClick = onDismissAway, modifier = Modifier.size(24.dp)) { Icon(Icons.Rounded.Close, "Dismiss catch-up", Modifier.size(15.dp)) } }
                        Text(state.awaySummary, fontSize = 12.sp, lineHeight = 19.sp, color = Muted)
                        TextButton(onClick = onWork, contentPadding = PaddingValues(0.dp)) { Text("See what changed", fontSize = 11.sp) }
                    }
                }
            }
            if (state.computerActive) item(key = "computer-in-use") { ComputerWorkCard(state, onRemote) }
            if (state.approvals.isNotEmpty()) item(key = "approvals") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { state.approvals.forEach { approval ->
                    SoftCard(Modifier.clickable { onApproval(approval.id) }, color = Color(0xFFFFF2DC)) {
                        Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Rounded.Shield, null, Modifier.size(18.dp), tint = Color(0xFF98701B)); Text("  Approval needed", fontSize = 12.sp, fontWeight = FontWeight.SemiBold) }
                        Text(approval.title, fontSize = 13.sp)
                        Text(approval.detail, fontSize = 11.sp, color = Muted, maxLines = 3)
                        Text("Review exact action", fontSize = 11.sp, color = Blue)
                    }
                } }
            }
            if (state.messages.isEmpty()) item {
                Column(Modifier.fillMaxWidth().padding(top = 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    AgentAvatar(modifier = Modifier.size(58.dp), hero = true)
                    Text("What can we do for you?", fontSize = 23.sp, fontWeight = FontWeight.Bold)
                    Text("Talk naturally. Your swarm can inspect projects, use your PC, and keep working with you.", color = Muted, fontSize = 13.sp, lineHeight = 19.sp)
                    listOf("Hey, what are you doing?", "Check my PC", "Build me a landing page").forEach { suggestion ->
                        Surface(onClick = { draft = suggestion }, shape = RoundedCornerShape(14.dp), color = Color.White, border = BorderStroke(1.dp, Line), modifier = Modifier.fillMaxWidth()) {
                            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) { Text(suggestion, Modifier.weight(1f), fontSize = 12.sp); Icon(Icons.Rounded.ArrowOutward, null, Modifier.size(15.dp), tint = Muted) }
                        }
                    }
                }
            }
            items(state.messages, key = { it.id }) { message ->
                Column(Modifier.fillMaxWidth(), horizontalAlignment = if (message.user) Alignment.End else Alignment.Start, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (!message.user) Text(state.chatRole?.let { role -> desktopAgents.find { it.id == role }?.name } ?: "SWARM", fontWeight = FontWeight.SemiBold, fontSize = 10.sp, color = Muted)
                    if (message.text.isNotBlank() || message.tools.isEmpty()) Surface(color = if (message.user) Color(0xFFE6EDFF) else Color.Transparent, shape = RoundedCornerShape(17.dp, 17.dp, if (message.user) 5.dp else 17.dp, if (message.user) 17.dp else 5.dp), modifier = if (message.user) Modifier.widthIn(max = 360.dp) else Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(if (message.user) 13.dp else 0.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            SelectionContainer { Text(message.text.ifBlank { if (message.status == "streaming") "Connecting to your agent…" else "" }, fontSize = 14.sp, lineHeight = 22.sp) }
                            if (message.detail.isNotBlank()) Text(message.detail, fontSize = 10.sp, color = if (message.status == "error") MaterialTheme.colorScheme.error else Muted)
                        }
                    }
                    message.tools.forEach { tool -> ToolActivityCard(tool) }
                    if (message.tools.any { it.tool.startsWith("computer.") }) TextButton(onClick = onRemote, contentPadding = PaddingValues(horizontal = 4.dp)) { Icon(Icons.Rounded.DesktopWindows, null, Modifier.size(15.dp)); Text("  View live PC", fontSize = 12.sp) }
                    if (message.runId.isNotBlank()) Surface(onClick = onWork, color = Color(0xFFEFF7F3), shape = RoundedCornerShape(12.dp)) {
                        Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Rounded.Bolt, null, Modifier.size(16.dp), tint = Blue)
                            Text("Team task · ${if (message.runId == state.runId) state.runStatus.ifBlank { "started" } else "view activity"}", fontSize = 11.sp)
                            Icon(Icons.Rounded.ChevronRight, null, Modifier.size(16.dp), tint = Muted)
                        }
                    }
                }
            }
        }
        WorkHandle(state, onWork)
        if (attachments.isNotEmpty()) androidx.compose.foundation.lazy.LazyRow(contentPadding = PaddingValues(horizontal = 18.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items(attachments) { file -> InputChip(selected = true, onClick = { attachments = attachments - file }, label = { Text(file.first, fontSize = 10.sp) }, trailingIcon = { Icon(Icons.Rounded.Close, "Remove attachment", Modifier.size(13.dp)) }) }
        }
        attachmentError?.let { Text(it, fontSize = 11.sp, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 18.dp)) }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp).background(Color.White, RoundedCornerShape(24.dp)).border(1.dp, Line, RoundedCornerShape(24.dp)).padding(4.dp), verticalAlignment = Alignment.Bottom) {
            IconButton(onClick = { pickFile.launch(arrayOf("text/*", "application/json", "application/javascript", "application/xml")) }, modifier = Modifier.size(40.dp), enabled = attachments.size < 5) { Icon(Icons.Rounded.AttachFile, "Attach text or code file", Modifier.size(19.dp), tint = Muted) }
            TextField(draft, { draft = it.take(8000) }, modifier = Modifier.weight(1f), placeholder = { Text("Ask SWARM anything…", fontSize = 12.sp) }, maxLines = 5,
                colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent))
            if (voiceAvailable) IconButton(onClick = { voice.launch(voiceIntent) }, modifier = Modifier.size(36.dp)) { Icon(Icons.Rounded.Mic, "Speak to SWARM", Modifier.size(19.dp), tint = Muted) }
            val stopAction = streaming && draft.isBlank() && attachments.isEmpty()
            FilledIconButton(onClick = { if (stopAction) onStop() else { val text = draft.trim().ifBlank { "Please inspect the attached files." }; onSendFiles(text, attachments); draft = ""; attachments = emptyList() } }, enabled = online && (stopAction || draft.isNotBlank() || attachments.isNotEmpty()), modifier = Modifier.size(42.dp)) {
                Icon(if (stopAction) Icons.Rounded.Stop else Icons.AutoMirrored.Rounded.Send, if (stopAction) "Stop response" else "Send message", Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun ToolActivityCard(tool: ToolItem) {
    var expanded by rememberSaveable(tool.id) { mutableStateOf(false) }
    val preview by produceState<androidx.compose.ui.graphics.ImageBitmap?>(null, tool.preview, expanded) {
        if (expanded && tool.preview.isNotBlank()) value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
            runCatching { val bytes = android.util.Base64.decode(tool.preview.substringAfter(','), android.util.Base64.DEFAULT); android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }.getOrNull()
        }
    }
    Surface(color = Color(0xFFF0F3FA), shape = RoundedCornerShape(13.dp), modifier = Modifier.fillMaxWidth().animateContentSize().clickable { expanded = !expanded }) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(if (tool.status == "complete") Icons.Rounded.CheckCircle else if (tool.status == "error") Icons.Rounded.ErrorOutline else if (tool.status == "approval") Icons.Rounded.Shield else if (tool.tool.startsWith("computer.")) Icons.Rounded.DesktopWindows else Icons.Rounded.AutoAwesome, null, Modifier.size(16.dp), tint = if (tool.status == "error") MaterialTheme.colorScheme.error else Blue)
                Text(tool.label, fontSize = 11.sp, modifier = Modifier.weight(1f))
                Text(when (tool.status) { "running" -> "Working…"; "approval" -> "Review needed"; "error" -> "Failed"; else -> "Done" }, fontSize = 9.sp, color = Muted)
            }
            if (expanded && tool.detail.isNotBlank()) SelectionContainer { Text(tool.detail, fontSize = 10.sp, color = if (tool.status == "error") MaterialTheme.colorScheme.error else Muted) }
            if (expanded) preview?.let { Image(it, "Observed PC screenshot", Modifier.fillMaxWidth().heightIn(max = 160.dp).clip(RoundedCornerShape(8.dp)), contentScale = androidx.compose.ui.layout.ContentScale.Fit) }
        }
    }
}
