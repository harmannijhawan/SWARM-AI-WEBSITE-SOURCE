package com.swarm.ai.ui.companion

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import com.swarm.ai.remote.ui.*

@Composable
fun HomePage(state: CompanionState, link: RemoteUiState, onBuild: () -> Unit, onAgents: () -> Unit, onRuns: () -> Unit, onModels: () -> Unit, onRemote: () -> Unit) {
    var section by rememberSaveable { mutableStateOf("Overview") }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(22.dp, 8.dp, 22.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item { Segments(listOf("Overview", "Activity"), section) { section = it } }
        if (section == "Overview") {
            item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                val active = state.team.count { it.status in listOf("working", "planning") }
                val running = state.tasks.count { it.status == "running" }
                val completed = state.tasks.count { it.status == "completed" }
                listOf(Triple("Active agents", active, Color(0xFFF0EBFF)), Triple("Running tasks", running, Color(0xFFEAF2FF)), Triple("Completed", completed, Color(0xFFE3F7EF))).forEachIndexed { i, (label, count, color) ->
                    Column(Modifier.weight(1f).background(color, RoundedCornerShape(20.dp)).padding(vertical = 15.dp, horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Icon(listOf(Icons.Rounded.SmartToy, Icons.Rounded.Layers, Icons.Rounded.TaskAlt)[i], null, Modifier.size(20.dp), tint = listOf(AgentColors[0], Blue, Color(0xFF1FA773))[i])
                        Text(if (state.loading) "—" else count.toString(), fontSize = 25.sp, fontWeight = FontWeight.Bold)
                        Text(label, fontSize = 10.sp, color = Muted)
                    }
                }
            } }
            item { Column(horizontalAlignment = Alignment.CenterHorizontally) {
                SwarmHero()
                Text(if (state.runStatus == "running") "Your swarm is on it." else "Big ideas. A little swarm.", fontSize = 22.sp, fontWeight = FontWeight.Bold, letterSpacing = (-.5).sp)
                Text(if (state.runStatus == "running") "Follow every step from your phone." else "Ready when inspiration strikes.", color = Muted, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
            } }
            item { SoftCard(Modifier.clickable(onClick = onModels)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    AgentAvatar(modifier = Modifier.size(38.dp), hero = true)
                    Column(Modifier.weight(1f)) {
                        Text(state.team.firstOrNull { it.model.isNotBlank() }?.model ?: "Auto · desktop routing", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("Current model", fontSize = 11.sp, color = Muted)
                    }
                    Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
                }
            } }
            item { PrimaryAction(if (state.runStatus == "running") "View live build" else "Build something great", onClick = onBuild) }
            // PC Connection card
            item { SoftCard(Modifier.clickable(onClick = onRemote)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Rounded.DesktopWindows, null, Modifier.size(38.dp).background(Color(0xFFECF1FF), RoundedCornerShape(10.dp)).padding(8.dp), tint = Blue)
                    Column(Modifier.weight(1f)) {
                        Text(if (link.link == LinkMode.LIVE || link.link == LinkMode.POLLING) link.pcName else "PC Not Connected", fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        Text(if (link.link == LinkMode.LIVE || link.link == LinkMode.POLLING) "Tap to view desktop" else "Waiting for connection", fontSize = 11.sp, color = Muted)
                    }
                    Icon(Icons.Rounded.ChevronRight, null, tint = Muted)
                }
            } }
            item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column { Text("System status", fontSize = 13.sp, fontWeight = FontWeight.Medium); Text(if (link.link == LinkMode.LIVE || link.link == LinkMode.POLLING) "${link.pcName} is reachable" else "Waiting for your PC", color = Muted, fontSize = 11.sp) }
                StatusPill(if (state.tasks.any { it.status == "failed" || it.status == "blocked" }) "Needs attention" else linkLabel(link), link.link == LinkMode.LIVE || link.link == LinkMode.POLLING)
            } }
        }
        item { SectionTitle("Recent activity", "Builds", onRuns) }
        if (state.activity.isEmpty()) item { SoftCard { Text("A little quiet here", fontWeight = FontWeight.SemiBold); Text("Your desktop’s task updates will appear as the swarm works.", color = Muted, fontSize = 13.sp) } }
        items(state.activity.take(if (section == "Overview") 3 else 12)) { activity ->
            Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Bolt, null, Modifier.size(32.dp).background(Color(0xFFECF1FF), RoundedCornerShape(10.dp)).padding(6.dp), tint = Blue)
                Text(activity, fontSize = 12.sp, lineHeight = 19.sp, color = Muted, modifier = Modifier.weight(1f))
            }
        }
        item { TextButton(onClick = onAgents, modifier = Modifier.fillMaxWidth()) { Text("Meet your agents"); Icon(Icons.Rounded.ChevronRight, null) } }
    }
}

@Composable
fun AgentsPage(state: CompanionState, online: Boolean, onAgent: (TeamMember) -> Unit, onRuns: () -> Unit, onCoordinator: () -> Unit = {}) {
    var filter by rememberSaveable { mutableStateOf("All agents") }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(22.dp, 8.dp, 22.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { PageTitle("Your team", "Talk directly to a specialist, or let SWARM coordinate the work.") }
        item { Surface(onClick = onCoordinator, shape = RoundedCornerShape(18.dp), color = Color(0xFFEAF0FF), modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                AgentAvatar(modifier = Modifier.size(38.dp), hero = true)
                Column(Modifier.weight(1f)) { Text("SWARM", fontWeight = FontWeight.SemiBold, fontSize = 14.sp); Text("Your coordinator · overall progress", color = Muted, fontSize = 11.sp) }
                Icon(Icons.Rounded.ChatBubbleOutline, "Chat with coordinator", tint = Blue, modifier = Modifier.size(20.dp))
            }
        } }
        item { Segments(listOf("All agents", "Working"), filter) { filter = it } }
        item { TextButton(onClick = onRuns) { Icon(Icons.Rounded.Layers, null, Modifier.size(17.dp)); Spacer(Modifier.width(6.dp)); Text(if (state.runId.isBlank()) "Choose a task" else "Change task", fontSize = 12.sp) } }
        val team = state.team.filter { filter == "All agents" || it.status in listOf("working", "planning") }
        if (team.isEmpty()) item { SoftCard { Text("No agents working right now", fontWeight = FontWeight.Medium); Text("Send SWARM a request and your team will get to work.", color = Muted) } }
        items(team, key = { it.identity.id }) { member ->
            AgentRow(member, { onAgent(member) }, !online)
            HorizontalDivider(color = Line)
        }
        item { Text("Agent messages reach the same specialists running on your PC. SWARM can keep coordinating their task while you chat.", color = Muted, fontSize = 12.sp, lineHeight = 19.sp) }
    }
}

@Composable
fun AgentDetail(member: TeamMember, hasRun: Boolean, onDismiss: () -> Unit, onChat: () -> Unit, events: List<WorkEvent> = emptyList()) {
    var section by rememberSaveable(member.identity.id) { mutableStateOf("Current task") }
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                AgentAvatar(desktopAgents.indexOf(member.identity), Modifier.size(80.dp), active = member.status == "working")
                Column(Modifier.weight(1f)) { Text(member.identity.name, fontSize = 26.sp, fontWeight = FontWeight.Bold); Text(member.identity.role, color = Muted, fontSize = 13.sp); Spacer(Modifier.height(8.dp)); StatusPill(member.status) }
            }
            Segments(listOf("Current task", "Activity"), section) { section = it }
            if (section == "Current task") SoftCard { Text("Current task", fontWeight = FontWeight.SemiBold); Text(member.task.ifBlank { "No task assigned yet" }, color = Muted); Text("Recent activity", fontWeight = FontWeight.SemiBold); Text(member.activity.ifBlank { "Waiting for the next assignment" }, color = Muted) }
            else if (events.isEmpty()) Text("No recent activity for this agent.", color = Muted, fontSize = 12.sp)
            else events.asReversed().filter { it.type !in setOf("message", "assistant_message", "agent_message") }.take(10).forEach { WorkEventCard(it) }
            if (member.model.isNotBlank()) Text("Model · ${member.model}", color = Muted, fontSize = 12.sp)
            PrimaryAction("Chat with ${member.identity.name}", enabled = hasRun, onClick = onChat)
            if (!hasRun) Text("Reconnect to your PC to talk with this agent.", color = Muted, fontSize = 12.sp)
        }
    }
}

@Composable
fun RunPicker(state: CompanionState, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        LazyColumn(contentPadding = PaddingValues(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { PageTitle("Your tasks", "Continue work from your desktop or phone.") }
            if (state.runs.isEmpty()) item { Text("No tasks yet. Ask SWARM to build, inspect, or fix something in Chat.", color = Muted) }
            items(state.runs, key = { it.id }) { run -> SoftCard(Modifier.clickable { onPick(run.id); onDismiss() }) {
                Text(run.objective, maxLines = 2, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                StatusPill(run.status)
            } }
        }
    }
}
