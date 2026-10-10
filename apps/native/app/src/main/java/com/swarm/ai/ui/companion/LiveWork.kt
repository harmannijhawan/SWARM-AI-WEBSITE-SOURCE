package com.swarm.ai.ui.companion

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

internal fun TeamMember.isWorking() = status in setOf("working", "running", "planning", "testing", "researching")
private fun activityEvents(state: CompanionState) = workActivity(state.workEvents)

@Composable
fun WorkHandle(state: CompanionState, onOpen: () -> Unit) {
    val active = state.team.count { it.isWorking() }
    val fileCount = state.files.map { it.path }.distinct().size
    val latest = activityEvents(state).firstOrNull()
    val title = when {
        state.approvals.isNotEmpty() -> "${state.approvals.size} ${if (state.approvals.size == 1) "approval needs" else "approvals need"} attention"
        active > 0 -> "$active ${if (active == 1) "agent working" else "agents working"}"
        state.runStatus == "running" -> "SWARM is working"
        else -> "Live work"
    }
    Surface(onClick = onOpen, shape = RoundedCornerShape(18.dp), color = Color(0xFFF0F3FA), modifier = Modifier
        .padding(horizontal = 14.dp, vertical = 3.dp).fillMaxWidth().testTag("work-drawer-handle")
        .pointerInput(onOpen) { detectVerticalDragGestures { change, delta -> if (delta < -8f) { change.consume(); onOpen() } } }) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(if (state.approvals.isNotEmpty()) Icons.Rounded.Shield else Icons.Rounded.Bolt, null, Modifier.size(17.dp), tint = Blue)
                Text(title, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                if (fileCount > 0) Text("$fileCount ${if (fileCount == 1) "file changed" else "files changed"}", color = Muted, fontSize = 10.sp)
                Icon(Icons.Rounded.KeyboardArrowUp, "Expand live work", Modifier.size(20.dp), tint = Muted)
            }
            latest?.message?.takeIf { it.isNotBlank() }?.let { Text(it, color = Muted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    }
}

@Composable
fun WorkSheet(state: CompanionState, onDismiss: () -> Unit, onAgent: (TeamMember) -> Unit, onRemote: () -> Unit, onFile: (WorkFile) -> Unit, onApproval: (String) -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false)) {
        WorkContent(state, onAgent, onRemote, onFile, onApproval, Modifier.fillMaxWidth().heightIn(max = 720.dp))
    }
}

@Composable
fun LiveWorkPage(state: CompanionState, onAgent: (TeamMember) -> Unit, onRemote: () -> Unit, onFile: (WorkFile) -> Unit, onApproval: (String) -> Unit, onRuns: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 18.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Swarm workspace", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
            TextButton(onClick = onRuns) { Icon(Icons.Rounded.History, null, Modifier.size(15.dp)); Text("  Tasks", fontSize = 12.sp) }
        }
        WorkContent(state, onAgent, onRemote, onFile, onApproval, Modifier.weight(1f))
    }
}

@Composable
private fun WorkContent(state: CompanionState, onAgent: (TeamMember) -> Unit, onRemote: () -> Unit, onFile: (WorkFile) -> Unit, onApproval: (String) -> Unit, modifier: Modifier) {
    var filter by rememberSaveable { mutableStateOf("Activity") }
    val events = remember(state.workEvents) { activityEvents(state) }
    val agents = state.team.filter { it.isWorking() || it.task.isNotBlank() || it.error.isNotBlank() }
    LazyColumn(modifier.testTag("live-work"), contentPadding = PaddingValues(18.dp, 8.dp, 18.dp, 28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item(key = "title") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("LIVE WORK", fontSize = 11.sp, color = Blue, fontWeight = FontWeight.Bold, letterSpacing = 1.5.sp)
                    Text(state.objective.ifBlank { "Your team's activity" }, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                if (state.runStatus.isNotBlank()) StatusPill(state.runStatus)
            }
        }
        if (state.computerActive) item(key = "computer") { ComputerWorkCard(state, onRemote) }
        if (agents.isNotEmpty()) item(key = "agents") {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(agents, key = { it.identity.id }) { member ->
                    Surface(onClick = { onAgent(member) }, shape = RoundedCornerShape(14.dp), color = Color.White, border = BorderStroke(1.dp, Line), modifier = Modifier.width(184.dp)) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                AgentAvatar(desktopAgents.indexOf(member.identity), Modifier.size(28.dp), active = member.isWorking())
                                Text(member.identity.name, fontWeight = FontWeight.SemiBold, fontSize = 12.sp)
                            }
                            Text(member.activity.ifBlank { member.task }.ifBlank { member.status }, fontSize = 11.sp, color = Muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            StatusPill(member.status)
                        }
                    }
                }
            }
        }
        items(state.approvals, key = { "approval-${it.id}" }) { approval ->
            Surface(onClick = { onApproval(approval.id) }, shape = RoundedCornerShape(14.dp), color = Color(0xFFFFF2DC)) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(Icons.Rounded.Shield, null, Modifier.size(20.dp), tint = Color(0xFF98701B))
                    Column(Modifier.weight(1f)) { Text("Approval required", fontSize = 11.sp, fontWeight = FontWeight.SemiBold); Text(approval.title, fontSize = 12.sp, maxLines = 2) }
                    Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
                }
            }
        }
        item(key = "filter") { Segments(listOf("Activity", "Files", "Tasks"), filter) { filter = it } }
        when (filter) {
            "Files" -> {
                if (state.files.isEmpty()) item { WorkEmpty("No file changes yet", "File updates appear here when a real tool saves, creates, or deletes a file.") }
                items(state.files.distinctBy { it.path }, key = { it.path }) { file -> WorkFileRow(file, onFile) }
            }
            "Tasks" -> {
                if (state.tasks.isEmpty()) item { WorkEmpty("No task plan yet", "Start with a message to SWARM. Your conversation stays with the work.") }
                items(state.tasks, key = { it.id }) { task ->
                    Surface(shape = RoundedCornerShape(14.dp), color = Color.White, border = BorderStroke(1.dp, Line)) {
                        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(task.title, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                            Row(verticalAlignment = Alignment.CenterVertically) { Text(desktopAgents.find { it.id == task.role }?.name ?: task.role, color = Muted, fontSize = 11.sp, modifier = Modifier.weight(1f)); StatusPill(task.status) }
                            if (task.status in listOf("failed", "blocked") && task.output.isNotBlank()) Text(task.output.take(600), color = MaterialTheme.colorScheme.error, fontSize = 11.sp)
                        }
                    }
                }
            }
            else -> {
                if (events.isEmpty()) item { WorkEmpty("Ready when you are", "Talk to SWARM in Chat. Real tool, computer, file, and agent events appear here as they happen.") }
                items(events, key = { it.id }) { event -> WorkEventCard(event, onRemote) }
            }
        }
        if (state.summary.isNotBlank()) item(key = "result") { SoftCard(color = Color(0xFFE9F8F1)) { Text("Task result", fontSize = 12.sp, fontWeight = FontWeight.SemiBold); SelectionContainer { Text(state.summary, fontSize = 12.sp) } } }
    }
}

@Composable
private fun WorkEmpty(title: String, detail: String) { Column(Modifier.fillMaxWidth().padding(vertical = 20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold); Text(detail, fontSize = 12.sp, lineHeight = 19.sp, color = Muted) } }

@Composable
fun ComputerWorkCard(state: CompanionState, onRemote: () -> Unit) {
    Surface(shape = RoundedCornerShape(16.dp), color = Color(0xFFEAF0FF), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) { Icon(Icons.Rounded.DesktopWindows, null, Modifier.size(18.dp), tint = Blue); Text("SWARM is using your PC", fontSize = 12.sp, fontWeight = FontWeight.SemiBold) }
            Text(state.workEvents.lastOrNull { it.type.startsWith("computer_") }?.message ?: "Computer tool is active", color = Muted, fontSize = 11.sp)
            TextButton(onClick = onRemote, contentPadding = PaddingValues(0.dp)) { Text("View live PC", fontSize = 12.sp); Icon(Icons.Rounded.ArrowOutward, null, Modifier.size(16.dp)) }
        }
    }
}

@Composable
fun WorkFileRow(file: WorkFile, onFile: (WorkFile) -> Unit) {
    Surface(onClick = { onFile(file) }, shape = RoundedCornerShape(14.dp), color = Color.White, border = BorderStroke(1.dp, Line), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(13.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Icon(Icons.Rounded.Description, null, Modifier.size(20.dp), tint = Blue)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(file.path, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(listOf(file.kind.replaceFirstChar { it.uppercase() }, desktopAgents.find { it.id == file.agent }?.name ?: file.agent).filter { it.isNotBlank() }.joinToString(" · "), fontSize = 10.sp, color = Muted)
            }
            Column(horizontalAlignment = Alignment.End) { file.additions?.let { Text("+$it", color = Color(0xFF15995A), fontSize = 11.sp) }; file.deletions?.let { Text("−$it", color = Color(0xFFC4495A), fontSize = 11.sp) } }
            Icon(Icons.Rounded.ChevronRight, "View file change", Modifier.size(18.dp), tint = Muted)
        }
    }
}

@Composable
fun WorkEventCard(event: WorkEvent, onRemote: () -> Unit = {}) {
    var expanded by rememberSaveable(event.id) { mutableStateOf(false) }
    val computer = event.type.startsWith("computer_")
    val command = event.type.startsWith("command_")
    val search = event.type.startsWith("search_")
    Surface(shape = RoundedCornerShape(14.dp), color = Color.White, border = BorderStroke(1.dp, Line), modifier = Modifier.fillMaxWidth().animateContentSize().clickable { expanded = !expanded }) {
        Column(Modifier.padding(13.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                Icon(when { computer -> Icons.Rounded.DesktopWindows; command -> Icons.Rounded.Terminal; search -> Icons.Rounded.Language; event.type.startsWith("file_") -> Icons.Rounded.Description; else -> Icons.Rounded.Bolt }, null, Modifier.size(19.dp), tint = Blue)
                Column(Modifier.weight(1f)) {
                    Text(when { computer -> "Computer"; command -> "Terminal"; search -> "Web research"; event.agent.isNotBlank() -> desktopAgents.find { it.id == event.agent }?.name ?: event.agent; else -> "SWARM" }, fontSize = 10.sp, color = Muted)
                    Text(event.message.ifBlank { event.type.replace('_', ' ') }, fontSize = 12.sp, lineHeight = 18.sp, maxLines = if (expanded) 10 else 2, overflow = TextOverflow.Ellipsis)
                }
                Icon(when (event.status) { "error" -> Icons.Rounded.ErrorOutline; "running" -> Icons.Rounded.MoreHoriz; "approval" -> Icons.Rounded.Shield; "stopped" -> Icons.Rounded.StopCircle; else -> Icons.Rounded.CheckCircle }, null, Modifier.size(17.dp), tint = if (event.status == "error") MaterialTheme.colorScheme.error else Muted)
            }
            if (event.path.isNotBlank()) Text(event.path, fontSize = 11.sp, color = Blue)
            if (event.command.isNotBlank()) Text("$ ${event.command}", fontFamily = FontFamily.Monospace, fontSize = 11.sp, maxLines = if (expanded) 10 else 2, overflow = TextOverflow.Ellipsis)
            if (expanded && event.detail.isNotBlank()) SelectionContainer { Text(event.detail, fontSize = 11.sp, fontFamily = if (command) FontFamily.Monospace else FontFamily.Default, lineHeight = 17.sp, color = Muted) }
            if (computer && expanded) TextButton(onClick = onRemote, contentPadding = PaddingValues(0.dp)) { Text("View live PC", fontSize = 12.sp) }
        }
    }
}

@Composable
fun FilePreviewSheet(preview: FilePreview, onDismiss: () -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 720.dp), contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { Text(preview.path, fontWeight = FontWeight.SemiBold, fontSize = 14.sp) }
            if (preview.truncated) item { Text("This preview is truncated or the original content is unavailable.", color = Muted, fontSize = 11.sp) }
            item { SelectionContainer { Text(preview.diff.ifBlank { "No text diff is available for this change." }, fontFamily = FontFamily.Monospace, fontSize = 11.sp, lineHeight = 17.sp, modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) } }
        }
    }
}
