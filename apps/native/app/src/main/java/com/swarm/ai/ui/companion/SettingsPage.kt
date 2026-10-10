package com.swarm.ai.ui.companion

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import com.swarm.ai.remote.ui.*
import com.swarm.ai.ui.screens.SettingsUiState

@Composable
fun SettingsPage(state: CompanionState, remote: RemoteUiState, local: SettingsUiState, onLocal: (SettingsUiState) -> Unit, onPreference: (Boolean, Boolean) -> Unit, onReconnect: () -> Unit, onDisconnect: () -> Unit, onModels: () -> Unit) {
    var disconnect by rememberSaveable { mutableStateOf(false) }
    var advanced by rememberSaveable { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(22.dp, 8.dp, 22.dp, 24.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item { PageTitle("Make it yours", "One swarm. Wherever you are.") }
        item { SectionTitle("SWARM connection") }
        item { SoftCard {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Rounded.Computer, null, Modifier.size(32.dp), tint = Blue)
                Column(Modifier.weight(1f)) { Text(remote.pcName.ifBlank { "Your PC" }, fontWeight = FontWeight.SemiBold); Text(remote.routeLabel ?: "Finding connection", color = Muted, fontSize = 12.sp) }
            }
            StatusPill(linkLabel(remote), remote.link in listOf(LinkMode.LIVE, LinkMode.POLLING))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onReconnect, modifier = Modifier.weight(1f)) { Text("Reconnect", fontSize = 12.sp) }
                TextButton(onClick = { disconnect = true }, modifier = Modifier.weight(1f)) { Text("Disconnect", color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
            }
        } }
        item { SectionTitle("AI & models") }
        item { SoftCard(Modifier.clickable(onClick = onModels)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Rounded.Memory, null, tint = Blue); Spacer(Modifier.width(12.dp)); Column(Modifier.weight(1f)) { Text("Desktop model routing", fontWeight = FontWeight.Medium); Text("See models used by your agents", color = Muted, fontSize = 12.sp) }; Icon(Icons.Rounded.ChevronRight, null, tint = Muted) }
            Text("Build and Chat use your PC’s AI settings. Change providers and model defaults in desktop Settings.", color = Muted, fontSize = 12.sp, lineHeight = 19.sp)
        } }
        item { SectionTitle("App experience") }
        item { SoftCard {
            SettingSwitch("Subtle animations", "Bring your swarm to life", state.motion) { onPreference(it, state.haptics) }
            HorizontalDivider(color = Line)
            SettingSwitch("Haptic feedback", "A little feedback with each tap", state.haptics) { onPreference(state.motion, it) }
            HorizontalDivider(color = Line)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("Appearance", fontSize = 14.sp); Text("SWARM Light", color = Muted, fontSize = 13.sp) }
        } }
        item { TextButton(onClick = { advanced = true }) { Text("Advanced · on-device inference"); Icon(Icons.Rounded.ChevronRight, null) } }
        item { SoftCard(color = Color(0xFFF0F3FC)) {
            Brand()
            Text("Your AI team. Everywhere.", fontSize = 15.sp, fontWeight = FontWeight.Medium)
            Text("SWARM for Android · Version 1.0\nYour mobile companion to SWARM desktop.", color = Muted, fontSize = 12.sp, lineHeight = 20.sp)
        } }
    }
    if (disconnect) AlertDialog(onDismissRequest = { disconnect = false }, title = { Text("Disconnect this phone?") }, text = { Text("This removes the saved pairing from your phone. Scan a new code to connect again.") }, confirmButton = { TextButton(onClick = { disconnect = false; onDisconnect() }) { Text("Disconnect") } }, dismissButton = { TextButton(onClick = { disconnect = false }) { Text("Stay connected") } })
    if (advanced) ModalBottomSheet(onDismissRequest = { advanced = false }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(24.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            PageTitle("On-device AI", "Saved preferences for local inference on this phone. Desktop builds use the PC’s settings.")
            SettingSwitch("Local inference", "Use the phone’s inference engine", local.localInferenceEnabled) { onLocal(local.copy(localInferenceEnabled = it)) }
            Text("Temperature · ${"%.1f".format(local.temperature)}", fontWeight = FontWeight.Medium)
            Slider(local.temperature, { onLocal(local.copy(temperature = it)) }, valueRange = 0f..2f, steps = 19)
            Text("Maximum tokens · ${local.maxTokens}", fontWeight = FontWeight.Medium)
            Slider(local.maxTokens.toFloat(), { onLocal(local.copy(maxTokens = it.toInt())) }, valueRange = 256f..8192f)
            OutlinedTextField(local.ollamaEndpoint, { onLocal(local.copy(ollamaEndpoint = it)) }, label = { Text("Local Ollama endpoint") }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp))
            TextButton(onClick = { advanced = false }) { Text("Done") }
        }
    }
}

@Composable
private fun SettingSwitch(title: String, subtitle: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.weight(1f)) { Text(title, fontSize = 14.sp, fontWeight = FontWeight.Medium); Text(subtitle, color = Muted, fontSize = 11.sp) }
        Switch(checked, onChange)
    }
}
