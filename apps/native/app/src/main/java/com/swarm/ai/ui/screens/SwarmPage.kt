package com.swarm.ai.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import com.swarm.ai.ui.companion.*

@Composable
fun SwarmPage(state: CompanionState, online: Boolean, onAgentClick: (TeamMember) -> Unit, onShowAll: () -> Unit) {
    val active = state.team.count { it.status in listOf("working", "planning", "running") }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(18.dp, 8.dp, 18.dp, 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text("Your swarm", fontSize = 20.sp, fontWeight = FontWeight.Bold); Text("$active active · ${state.approvals.size} waiting for approval", fontSize = 11.sp, color = Muted) }
            StatusPill(if (online) "Live" else "Reconnecting", online)
        } }
        if (state.objective.isNotBlank()) item { SoftCard { Text(state.objective, fontSize = 13.sp, maxLines = 3); StatusPill(state.runStatus) } }
        val team = state.team.sortedBy { if (it.status in listOf("working", "planning", "blocked", "failed", "waiting")) 0 else 1 }
        items(team, key = { it.identity.id }) { member -> AgentWorkCard(member) { onAgentClick(member) } }
        item { TextButton(onClick = onShowAll, modifier = Modifier.fillMaxWidth()) { Text("Agent conversations", fontSize = 12.sp) } }
        if (state.activity.isNotEmpty()) {
            item { Text("Latest steps", fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
            items(state.activity.take(6)) { Text(it, fontSize = 12.sp, lineHeight = 18.sp, color = Muted) }
        }
    }
}

@Composable
fun AgentWorkCard(member: TeamMember, onClick: () -> Unit) {
    SoftCard(Modifier.clickable(onClick = onClick), color = Color.White) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            AgentAvatar(desktopAgents.indexOf(member.identity), Modifier.size(40.dp), active = member.status in listOf("working", "planning"))
            Column(Modifier.weight(1f)) { Text(member.identity.name, fontWeight = FontWeight.SemiBold, fontSize = 14.sp); Text(member.identity.role, color = Muted, fontSize = 10.sp) }
            StatusPill(member.status)
        }
        if (member.task.isNotBlank()) Text(member.task, fontSize = 12.sp, maxLines = 3)
        if (member.activity.isNotBlank()) Text(member.activity, fontSize = 11.sp, lineHeight = 16.sp, color = Muted, maxLines = 3)
        if (member.total > 0) {
            LinearProgressIndicator(progress = { member.done.toFloat() / member.total }, modifier = Modifier.fillMaxWidth().height(4.dp), trackColor = Line)
            Text("${member.done} of ${member.total} tasks verified", fontSize = 10.sp, color = Muted)
        }
        if (member.waitingFor.isNotBlank()) Text("Waiting for: ${member.waitingFor}", fontSize = 11.sp, color = Color(0xFF946B16))
        if (member.error.isNotBlank()) Text(member.error, fontSize = 11.sp, color = MaterialTheme.colorScheme.error, maxLines = 4)
    }
}
