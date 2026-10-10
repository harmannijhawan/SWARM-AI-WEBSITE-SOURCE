package com.swarm.ai.ui.companion

import androidx.compose.animation.core.*
import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.*
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import com.swarm.ai.R
import com.swarm.ai.remote.ui.*

val Ink = Color(0xFF101522)
val Muted = Color(0xFF69738D)
val Blue = Color(0xFF2463FF)
val Line = Color(0xFFE7EBF5)
val AgentColors = listOf(Color(0xFF9270F5), Color(0xFF359AFF), Color(0xFFFFAA51), Color(0xFFF076B3), Color(0xFF32C6A0))
val LocalMotion = staticCompositionLocalOf { true }

@Composable
fun Brand() {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(R.drawable.swarm_mark), contentDescription = null, Modifier.size(34.dp))
        Text("SWARM", fontSize = 19.sp, letterSpacing = 1.sp, fontWeight = FontWeight.ExtraBold)
    }
}

fun linkLabel(s: RemoteUiState) = when {
    !s.paired -> "Disconnected"
    s.link == LinkMode.LIVE || s.link == LinkMode.POLLING -> "PC Connected"
    s.link == LinkMode.CONNECTING -> "Connecting"
    else -> "Reconnecting"
}

@Composable
fun StatusPill(text: String, good: Boolean = false, modifier: Modifier = Modifier) {
    val color = when {
        good || text.lowercase() in listOf("completed", "online", "ready") -> Color(0xFF15995A)
        text.lowercase() in listOf("failed", "error", "offline") -> Color(0xFFC4495A)
        text.lowercase() in listOf("working", "planning", "running", "connecting", "streaming") -> Blue
        else -> Muted
    }
    Row(modifier.clip(CircleShape).background(color.copy(alpha = .09f)).padding(horizontal = 10.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Box(Modifier.size(5.dp).background(color, CircleShape))
        Text(text.replaceFirstChar { it.uppercase() }, color = color, fontSize = 10.sp, fontWeight = FontWeight.Medium, maxLines = 1)
    }
}

@Composable
fun SoftCard(modifier: Modifier = Modifier, color: Color = Color.White, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().shadow(5.dp, RoundedCornerShape(24.dp), spotColor = Color(0xFFB9C8F2), ambientColor = Color(0xFFDBE1F2))
        .clip(RoundedCornerShape(24.dp)).background(color).border(1.dp, Line.copy(alpha = .7f), RoundedCornerShape(24.dp)).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
}

@Composable
fun PageTitle(title: String, subtitle: String = "") {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, fontSize = 30.sp, lineHeight = 35.sp, letterSpacing = (-1).sp, fontWeight = FontWeight.Bold)
        if (subtitle.isNotEmpty()) Text(subtitle, color = Muted, fontSize = 14.sp, lineHeight = 21.sp)
    }
}

@Composable
fun SectionTitle(title: String, action: String? = null, onAction: () -> Unit = {}) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, modifier = Modifier.weight(1f))
        if (action != null) TextButton(onClick = onAction) { Text(action, fontSize = 12.sp) }
    }
}

@Composable
fun PrimaryAction(text: String, enabled: Boolean = true, busy: Boolean = false, onClick: () -> Unit) {
    Button(onClick, enabled = enabled && !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp), shape = RoundedCornerShape(18.dp)) {
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        else { Text(text, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f)); Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, Modifier.size(20.dp)) }
    }
}

@Composable
fun Segments(values: List<String>, selected: String, onSelect: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color(0xFFEEF1F8)).padding(4.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        values.forEach { value ->
            val color by animateColorAsState(if (value == selected) Ink else Color.Transparent, tween(if (LocalMotion.current) 160 else 0), label = "segment")
            Box(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(color)
                .selectable(value == selected, role = Role.Tab, onClick = { onSelect(value) }).heightIn(min = 42.dp).padding(horizontal = 5.dp), contentAlignment = Alignment.Center) {
                Text(value, color = if (selected == value) Color.White else Muted, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

/** Small vector characters stay crisp at every phone density and avoid loading large image assets. */
@Composable
fun AgentAvatar(index: Int = 0, modifier: Modifier = Modifier.size(56.dp), hero: Boolean = false, active: Boolean = false) {
    val motion = LocalMotion.current && active
    val float = if (motion) {
        val transition = rememberInfiniteTransition(label = "agent float")
        transition.animateFloat(-3f, 3f, infiniteRepeatable(tween(1900, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "float").value
    } else 0f
    val tint = if (hero) Color(0xFFB4C7FF) else AgentColors[index.mod(AgentColors.size)]
    Canvas(modifier.graphicsLayer { translationY = float }) {
        val scale = size.minDimension / 100f
        scale(scale, scale, pivot = Offset.Zero) {
            drawOval(tint.copy(alpha = .15f), Offset(19f, 89f), Size(62f, 8f))
            drawRoundRect(Brush.verticalGradient(listOf(Color.White, tint), 62f, 91f), Offset(32f, 65f), Size(38f, 27f), CornerRadius(17f))
            drawCircle(Color.White.copy(alpha = .8f), 4f, Offset(51f, 80f))
            drawLine(tint, Offset(52f, 24f), Offset(59f, 8f), 3f, StrokeCap.Round)
            drawCircle(tint, 4f, Offset(59f, 8f))
            drawOval(Brush.horizontalGradient(listOf(tint, Color.White)), Offset(6f, 38f), Size(17f, 29f))
            drawOval(Brush.horizontalGradient(listOf(Color.White, tint)), Offset(79f, 38f), Size(16f, 29f))
            drawRoundRect(Brush.linearGradient(listOf(Color.White, tint.copy(alpha = .6f), tint), Offset(20f, 22f), Offset(83f, 81f)), Offset(16f, 21f), Size(69f, 56f), CornerRadius(25f))
            drawRoundRect(Color.White.copy(alpha = .8f), Offset(19f, 23f), Size(61f, 49f), CornerRadius(22f), style = Stroke(1.5f))
            drawRoundRect(Brush.verticalGradient(listOf(Color(0xFF26375F), Color(0xFF081022)), 30f, 67f), Offset(25f, 31f), Size(51f, 36f), CornerRadius(16f))
            drawOval(Color.White.copy(alpha = .14f), Offset(30f, 33f), Size(35f, 10f))
            val eye = if (hero) Color(0xFF6CD4FF) else Color.White
            drawRoundRect(eye.copy(alpha = .16f), Offset(33f, 39f), Size(12f, 19f), CornerRadius(6f))
            drawRoundRect(eye, Offset(36f, 42f), Size(6f, 12f), CornerRadius(4f))
            drawRoundRect(eye.copy(alpha = .16f), Offset(56f, 39f), Size(12f, 19f), CornerRadius(6f))
            drawRoundRect(eye, Offset(59f, 42f), Size(6f, 12f), CornerRadius(4f))
            drawArc(eye, 20f, 140f, false, Offset(46f, 53f), Size(9f, 5f), style = Stroke(1.5f, cap = StrokeCap.Round))
        }
    }
}

@Composable
fun SwarmHero(modifier: Modifier = Modifier, single: Boolean = false) {
    Box(modifier.fillMaxWidth().height(if (single) 200.dp else 210.dp), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            drawCircle(Brush.radialGradient(listOf(Color(0xFFDDE8FF).copy(alpha = .7f), Color.Transparent), radius = size.height * .58f), size.height * .58f)
            drawOval(Color(0xFFDCE5FC), Offset(size.width * .15f, size.height * .28f), Size(size.width * .7f, size.height * .55f), style = Stroke(1.dp.toPx()))
            listOf(.12f to .3f, .8f to .2f, .25f to .8f, .9f to .7f).forEach { (x, y) -> drawCircle(Color(0xFFBFD4FF), 4.dp.toPx(), Offset(size.width * x, size.height * y)) }
        }
        AgentAvatar(modifier = Modifier.size(if (single) 166.dp else 142.dp), hero = true, active = true)
        if (!single) {
            AgentAvatar(0, Modifier.align(Alignment.TopStart).padding(start = 24.dp, top = 6.dp).size(68.dp), active = true)
            AgentAvatar(2, Modifier.align(Alignment.TopEnd).padding(end = 27.dp, top = 8.dp).size(62.dp))
            AgentAvatar(1, Modifier.align(Alignment.BottomStart).padding(start = 29.dp, bottom = 8.dp).size(62.dp))
            AgentAvatar(3, Modifier.align(Alignment.BottomEnd).padding(end = 28.dp, bottom = 7.dp).size(67.dp), active = true)
        }
    }
}

@Composable
fun AgentRow(member: TeamMember, onClick: () -> Unit, offline: Boolean = false) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).clickable(onClick = onClick).padding(vertical = 12.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        AgentAvatar(desktopAgents.indexOf(member.identity), active = member.status in listOf("working", "planning") && !offline)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(member.identity.name, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(member.identity.role, color = Muted, fontSize = 11.sp)
            if (member.task.isNotBlank()) Text(member.task, color = Muted, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        StatusPill(if (offline) "Offline" else member.status)
    }
}
