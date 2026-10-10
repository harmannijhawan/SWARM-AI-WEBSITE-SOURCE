package com.swarm.ai.ui.companion

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.swarm.ai.remote.ui.*

@Composable
fun ConnectionScreen(state: RemoteUiState, onPair: (String) -> Unit) {
    var mode by rememberSaveable { mutableStateOf("Scan QR Code") }
    var scan by rememberSaveable { mutableStateOf(false) }
    var help by rememberSaveable { mutableStateOf(false) }
    var payload by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 24.dp, vertical = 14.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { Brand() }
            IconButton(onClick = { help = true }) { Icon(Icons.Rounded.HelpOutline, "Connection help", tint = Muted) }
        }
        SwarmHero(single = true)
        Text("Connect your SWARM", fontSize = 27.sp, letterSpacing = (-.7).sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        Text("Your AI team. Everywhere.\nTurn your phone into your PC’s command center.", color = Muted, fontSize = 14.sp, lineHeight = 22.sp, textAlign = TextAlign.Center)
        Segments(listOf("Scan QR Code", "Enter Manually"), mode) { mode = it }
        if (state.pairingInProgress) {
            SoftCard {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    CircularProgressIndicator(Modifier.size(26.dp), strokeWidth = 2.dp)
                    Column { Text("Connecting to your PC", fontWeight = FontWeight.SemiBold); Text("Keep SWARM open on your desktop.", fontSize = 12.sp, color = Muted) }
                }
            }
        } else if (mode == "Scan QR Code") {
            SoftCard(color = Color(0xFFF0F5FF)) {
                Box(Modifier.fillMaxWidth().height(114.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(102.dp).clip(RoundedCornerShape(26.dp)).background(Color.White).border(1.dp, Color(0xFFD9E5FF), RoundedCornerShape(26.dp)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Rounded.QrCodeScanner, null, Modifier.size(54.dp), tint = Blue)
                    }
                }
                PrimaryAction("Open camera", onClick = { scan = true })
            }
        } else {
            SoftCard {
                OutlinedTextField(payload, { payload = it }, Modifier.fillMaxWidth(), label = { Text("Pairing code from your PC") }, minLines = 3, maxLines = 5, shape = RoundedCornerShape(16.dp))
                PrimaryAction("Connect to PC", payload.isNotBlank(), onClick = { onPair(payload) })
            }
        }
        state.message?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp, textAlign = TextAlign.Center) }
        Text("Open SWARM → Remote on your desktop,\nthen scan its pairing code with your phone.", color = Muted, fontSize = 12.sp, lineHeight = 19.sp, textAlign = TextAlign.Center)
        TextButton(onClick = { help = true }) { Icon(Icons.Rounded.Lightbulb, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("How to connect") }
    }
    if (scan) ModalBottomSheet(onDismissRequest = { scan = false }) {
        Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Scan your desktop code", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("Point your camera at the QR code in SWARM → Remote.", color = Muted)
            QrScannerView(onQrText = { scan = false; onPair(it) }, modifier = Modifier.fillMaxWidth().height(340.dp).clip(RoundedCornerShape(24.dp)))
            TextButton(onClick = { scan = false; mode = "Enter Manually" }) { Text("Enter code manually instead") }
        }
    }
    if (help) ModalBottomSheet(onDismissRequest = { help = false }) {
        Column(Modifier.padding(24.dp).navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            PageTitle("Your desktop.\nIn your pocket.")
            listOf("Open SWARM on your PC and enable Remote.", "Show a fresh pairing QR code on the PC.", "Tap Open camera here and scan that code.", "Keep your PC awake and reachable on your network.").forEachIndexed { i, text ->
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) { Text("0${i + 1}", color = Blue, fontWeight = FontWeight.Bold); Text(text, color = Muted) }
            }
            PrimaryAction("Got it", onClick = { help = false })
        }
    }
}
