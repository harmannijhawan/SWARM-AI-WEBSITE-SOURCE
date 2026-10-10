package com.swarm.ai.ui.screens

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.*
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.swarm.ai.remote.ui.RemoteUiState
import com.swarm.ai.ui.companion.CompanionState
import kotlin.math.roundToInt

enum class RemoteMode { DESKTOP, TRACKPAD, KEYBOARD }

/** Maps fitted/zoomed image pixels; letterbox touches never reach the OS. */
internal fun desktopPoint(point: Offset, viewport: IntSize, width: Int, height: Int, zoom: Float, pan: Offset = Offset.Zero): Pair<Int, Int>? {
    if (width <= 0 || height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null
    val fit = minOf(viewport.width.toFloat() / width, viewport.height.toFloat() / height) * zoom
    val x = (point.x - viewport.width / 2f - pan.x) / fit + width / 2f
    val y = (point.y - viewport.height / 2f - pan.y) / fit + height / 2f
    if (x < 0 || y < 0 || x >= width || y >= height) return null
    return x.roundToInt().coerceIn(0, width - 1) to y.roundToInt().coerceIn(0, height - 1)
}

@Composable
fun RemotePCPage(state: CompanionState, link: RemoteUiState, online: Boolean, viewModel: RemotePCViewModel = hiltViewModel(), onBack: () -> Unit = {}) {
    val stream by viewModel.streamState.collectAsStateWithLifecycle()
    var mode by rememberSaveable { mutableStateOf(RemoteMode.DESKTOP) }
    var controls by rememberSaveable { mutableStateOf(true) }
    var drag by rememberSaveable { mutableStateOf(false) }
    var zoom by rememberSaveable { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    var keyboard by rememberSaveable { mutableStateOf("") }
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    var dragPoint by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    DisposableEffect(viewModel) { viewModel.startStream(); onDispose { viewModel.stopStream() } }
    fun map(point: Offset) = desktopPoint(point, viewport, stream.frameWidth, stream.frameHeight, zoom, pan)
    val mapLatest by rememberUpdatedState<(Offset) -> Pair<Int, Int>?>({ map(it) })
    Column(Modifier.fillMaxSize().background(Color(0xFF10141F)).imePadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack, modifier = Modifier.size(40.dp)) { Icon(Icons.Rounded.ArrowBack, "Back to chat", tint = Color.White, modifier = Modifier.size(20.dp)) }
            Column(Modifier.weight(1f)) {
                Text(link.pcName.ifBlank { "SWARM PC" }, color = Color.White, fontSize = 13.sp)
                Text(if (online) "● Connected" else "● Reconnecting", color = if (online) Color(0xFF69D9AB) else Color(0xFFE2B872), fontSize = 10.sp)
            }
            if (stream.isStreaming) Text("${stream.fps} fps · ${stream.latencyMs} ms", color = Color(0xFF9DAAC0), fontSize = 10.sp)
            IconButton(onClick = { controls = !controls }, modifier = Modifier.size(40.dp)) { Icon(if (controls) Icons.Rounded.ExpandMore else Icons.Rounded.Tune, "Toggle controls", tint = Color.White) }
        }
        if (state.computerActive) Row(Modifier.fillMaxWidth().background(Color(0xFF233653)).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Computer, null, tint = Color(0xFF91B3FF), modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(8.dp))
            Text("SWARM is using your PC", color = Color.White, fontSize = 11.sp)
        }
        stream.error?.let { error -> Row(Modifier.fillMaxWidth().background(Color(0xFF522933)).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(error, color = Color.White, fontSize = 11.sp, modifier = Modifier.weight(1f))
            TextButton(onClick = { viewModel.stopStream(); viewModel.startStream() }) { Text("Retry", color = Color.White) }
        } }
        Box(Modifier.weight(1f).fillMaxWidth().testTag("live-desktop").onSizeChanged { viewport = it }
            .pointerInput(mode, drag) {
                if (!drag && mode != RemoteMode.KEYBOARD) detectTapGestures(onTap = { p ->
                    if (mode == RemoteMode.TRACKPAD) viewModel.sendTrackpadTap() else mapLatest(p)?.let { (x, y) -> viewModel.sendClick(x, y) }
                }, onDoubleTap = { p -> if (mode == RemoteMode.TRACKPAD) viewModel.sendTrackpadTap(double = true) else mapLatest(p)?.let { (x, y) -> viewModel.sendClick(x, y, double = true) } }, onLongPress = { p -> if (mode == RemoteMode.TRACKPAD) viewModel.sendTrackpadTap(button = "right") else mapLatest(p)?.let { (x, y) -> viewModel.sendClick(x, y, button = "right") } })
            }
            .pointerInput(mode, drag) {
                if (drag && mode == RemoteMode.DESKTOP) detectDragGestures(
                    onDragStart = { p -> mapLatest(p)?.let { dragPoint = it; viewModel.sendDrag(it.first, it.second, "start") } },
                    onDragEnd = { dragPoint?.let { viewModel.sendDrag(it.first, it.second, "end") }; dragPoint = null },
                    onDragCancel = { dragPoint?.let { viewModel.sendDrag(it.first, it.second, "end") }; dragPoint = null }
                ) { change, _ -> change.consume(); mapLatest(change.position)?.let { dragPoint = it; viewModel.sendDrag(it.first, it.second, "move") } }
                else if (mode == RemoteMode.TRACKPAD) awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    var scrolling = 0f
                    do {
                        val event = awaitPointerEvent()
                        val pressed = event.changes.filter { it.pressed }
                        if (pressed.size >= 2) {
                            scrolling += event.calculatePan().y
                            if (kotlin.math.abs(scrolling) >= 16f) { viewModel.sendScroll((-scrolling / 16f).roundToInt()); scrolling = 0f }
                        } else if (pressed.size == 1) {
                            val delta = pressed[0].positionChange()
                            viewModel.sendMove((delta.x * 1.6f).roundToInt(), (delta.y * 1.6f).roundToInt(), true)
                        }
                        if (pressed.any { it.positionChanged() }) event.changes.forEach { it.consume() }
                    } while (event.changes.any { it.pressed })
                }
            }
            .pointerInput(mode, drag) {
                if (mode == RemoteMode.DESKTOP && !drag) detectTransformGestures { _, movement, scale, _ ->
                    zoom = (zoom * scale).coerceIn(1f, 4f)
                    val limitX = viewport.width * (zoom - 1f) / 2f
                    val limitY = viewport.height * (zoom - 1f) / 2f
                    pan = Offset((pan.x + movement.x).coerceIn(-limitX, limitX), (pan.y + movement.y).coerceIn(-limitY, limitY))
                }
            }, contentAlignment = Alignment.Center) {
            stream.frame?.let { frame -> Image(frame, "Real PC desktop", Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = pan.x; translationY = pan.y }, contentScale = ContentScale.Fit) }
                ?: Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    CircularProgressIndicator(Modifier.size(24.dp), color = Color(0xFF7EA4FF), strokeWidth = 2.dp)
                    Text(if (online) "Waiting for a real desktop frame…" else "Reconnecting to your paired PC…", color = Color(0xFF9DAAC0), fontSize = 12.sp)
                }
        }
        if (controls) {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                listOf(RemoteMode.DESKTOP to "Mouse", RemoteMode.TRACKPAD to "Trackpad", RemoteMode.KEYBOARD to "Keyboard").forEach { (value, title) ->
                    TextButton(onClick = { mode = value; drag = false }) { Text(title, fontSize = 11.sp, color = if (mode == value) Color(0xFF91B3FF) else Color.White) }
                }
                TextButton(onClick = { zoom = 1f; pan = Offset.Zero }) { Text("Fit", color = Color.White, fontSize = 11.sp) }
                TextButton(onClick = { zoom = (zoom + .5f).let { if (it > 3f) 1f else it } }) { Text("${zoom}×", color = Color.White, fontSize = 11.sp) }
                if (mode == RemoteMode.DESKTOP) TextButton(onClick = { drag = !drag }) { Text(if (drag) "Drag on" else "Drag", color = if (drag) Color(0xFF91B3FF) else Color.White, fontSize = 11.sp) }
                TextButton(onClick = { viewModel.sendScroll(-3) }) { Text("↑", color = Color.White) }
                TextButton(onClick = { viewModel.sendScroll(3) }) { Text("↓", color = Color.White) }
            }
            if (mode == RemoteMode.KEYBOARD) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(keyboard, { keyboard = it.take(8000) }, Modifier.weight(1f), placeholder = { Text("Type on your PC", fontSize = 12.sp) }, maxLines = 3,
                        colors = OutlinedTextFieldDefaults.colors(focusedTextColor = Color.White, unfocusedTextColor = Color.White), shape = RoundedCornerShape(14.dp))
                    IconButton(onClick = { if (keyboard.isNotEmpty()) { viewModel.sendKey("", text = keyboard); keyboard = "" } }) { Icon(Icons.Rounded.Send, "Type text on PC", tint = Color.White) }
                }
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                    listOf("Enter", "Backspace", "Tab", "Escape", "Delete").forEach { key -> TextButton(onClick = { viewModel.sendKey(key) }) { Text(key, color = Color.White, fontSize = 11.sp) } }
                    listOf("a", "c", "v", "z", "s").forEach { key -> TextButton(onClick = { viewModel.sendKey(key, modifiers = listOf("ctrl")) }) { Text("Ctrl+${key.uppercase()}", color = Color.White, fontSize = 11.sp) } }
                    TextButton(onClick = { viewModel.sendKey("Tab", modifiers = listOf("alt")) }) { Text("Alt+Tab", color = Color.White, fontSize = 11.sp) }
                }
            }
        }
    }
}
