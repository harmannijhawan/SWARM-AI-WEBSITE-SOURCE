package com.swarm.ai.ui.screens

import android.graphics.BitmapFactory
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.swarm.ai.remote.RemoteClient
import com.swarm.ai.remote.WsEvent
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.*
import javax.inject.Inject

data class DesktopStreamState(val frame: ImageBitmap? = null, val fps: Int = 0, val latencyMs: Int = 0, val frameWidth: Int = 0, val frameHeight: Int = 0, val sequence: Int = 0, val isStreaming: Boolean = false, val error: String? = null)
data class StreamQuality(val name: String, val maxFps: Int, val maxWidth: Int, val maxHeight: Int) {
    companion object {
        val AUTO = StreamQuality("auto", 20, 1280, 720)
        val LOW = StreamQuality("low", 12, 960, 540)
        val MEDIUM = StreamQuality("medium", 20, 1600, 900)
        val HIGH = StreamQuality("high", 25, 1920, 1080)
    }
}

@HiltViewModel
class RemotePCViewModel @Inject constructor(private val client: RemoteClient) : ViewModel() {
    private val _streamState = MutableStateFlow(DesktopStreamState())
    val streamState = _streamState.asStateFlow()
    private var streamJob: Job? = null
    private var frameCount = 0
    private var lastFrameAt = 0L
    private var quality = StreamQuality.AUTO
    private val inputs = Channel<suspend () -> Unit>(64)
    private data class Move(val x: Int, val y: Int, val relative: Boolean, val width: Int, val height: Int)
    private val moves = Channel<Move>(Channel.CONFLATED)
    init {
        viewModelScope.launch { for (input in inputs) perform(input) }
        viewModelScope.launch { for (move in moves) { perform { client.sendDesktopInput("move", x = move.x, y = move.y, relative = move.relative, frameWidth = move.width, frameHeight = move.height) }; delay(16) } }
    }
    private suspend fun perform(action: suspend () -> Unit) {
        try { action() } catch (e: CancellationException) { throw e } catch (e: Exception) { _streamState.update { it.copy(error = e.message ?: "PC input failed") } }
    }
    private fun input(action: suspend () -> Unit) {
        if (!inputs.trySend(action).isSuccess) _streamState.update { it.copy(error = "PC input is busy. Wait for the current operation.") }
    }
    fun startStream(quality: StreamQuality = this.quality) {
        if (streamJob?.isActive == true) return
        this.quality = quality
        streamJob = viewModelScope.launch {
            launch {
                client.desktopFrames().buffer(1, BufferOverflow.DROP_OLDEST).collect { frame ->
                    val bitmap = withContext(Dispatchers.Default) { BitmapFactory.decodeByteArray(frame.jpegData, 0, frame.jpegData.size) }
                    if (bitmap == null || bitmap.width != frame.width || bitmap.height != frame.height) {
                        _streamState.update { it.copy(error = "Invalid desktop JPEG received") }
                    } else {
                        frameCount++; lastFrameAt = System.currentTimeMillis()
                        _streamState.update { it.copy(frame = bitmap.asImageBitmap(), frameWidth = frame.width, frameHeight = frame.height, sequence = frame.sequence, isStreaming = true, error = null,
                            latencyMs = if (frame.timestamp > 0) (lastFrameAt - frame.timestamp).coerceIn(0, 60000).toInt() else 0) }
                    }
                }
            }
            launch {
                client.events().filter { it is WsEvent.DesktopError || it is WsEvent.Failure || it is WsEvent.Closed }.collect { event ->
                    _streamState.update { it.copy(isStreaming = false, error = when (event) { is WsEvent.DesktopError -> event.error; is WsEvent.Failure -> event.error.message; else -> "Reconnecting to your PC…" }) }
                }
            }
            launch {
                client.socketConnected.collectLatest { connected ->
                    if (connected) {
                        // The OS capture source can temporarily disappear during unlock or reconnect.
                        for (attempt in 0..2) {
                            try {
                                val q = this@RemotePCViewModel.quality
                                client.startDesktopStream(q.name, q.maxFps, q.maxWidth, q.maxHeight)
                                lastFrameAt = System.currentTimeMillis()
                                break
                            } catch (e: CancellationException) { throw e }
                            catch (e: Exception) {
                                _streamState.update { it.copy(error = e.message ?: "Desktop capture could not start", isStreaming = false) }
                                if (attempt < 2) delay((attempt + 1) * 1000L)
                            }
                        }
                    } else _streamState.update { it.copy(isStreaming = false) }
                }
            }
            while (isActive) {
                delay(1000)
                val stalled = client.socketConnected.value && lastFrameAt > 0 && System.currentTimeMillis() - lastFrameAt > 8000
                _streamState.update { it.copy(fps = frameCount, isStreaming = it.isStreaming && !stalled, error = if (stalled) "Connected, but the PC is not producing desktop frames." else it.error) }
                frameCount = 0
            }
        }
    }
    fun stopStream() {
        streamJob?.cancel(); streamJob = null
        viewModelScope.launch { runCatching { client.stopDesktopStream() } }
        _streamState.value = DesktopStreamState()
    }
    fun setQuality(value: StreamQuality) {
        quality = value
        input { client.setDesktopOptions(value.name, value.maxFps, value.maxWidth, value.maxHeight) }
    }
    fun sendClick(x: Int, y: Int, button: String = "left", double: Boolean = false) {
        val frame = _streamState.value
        if (!frame.isStreaming) return
        input { client.sendDesktopInput("click", x = x, y = y, button = button, double = double, frameWidth = frame.frameWidth, frameHeight = frame.frameHeight) }
    }
    fun sendMove(x: Int, y: Int, relative: Boolean = false) {
        val frame = _streamState.value
        if (frame.isStreaming) moves.trySend(Move(x, y, relative, frame.frameWidth, frame.frameHeight))
    }
    fun sendTrackpadTap(button: String = "left", double: Boolean = false) {
        if (_streamState.value.isStreaming) input { client.sendDesktopInput("click", button = button, double = double) }
    }
    fun sendDrag(x: Int, y: Int, phase: String) {
        val frame = _streamState.value
        if (!frame.isStreaming && phase != "end") return
        input { client.sendDesktopInput("drag", x = x, y = y, button = "left", phase = phase, frameWidth = frame.frameWidth, frameHeight = frame.frameHeight) }
    }
    fun sendScroll(deltaY: Int, deltaX: Int = 0) = input { client.sendDesktopInput("scroll", deltaY = deltaY.coerceIn(-100, 100), deltaX = deltaX.coerceIn(-100, 100)) }
    fun sendKey(key: String, text: String? = null, modifiers: List<String>? = null) = input { client.sendDesktopInput("key", key = key.ifEmpty { null }, text = text, modifiers = modifiers) }
    override fun onCleared() { streamJob?.cancel(); inputs.close(); moves.close(); super.onCleared() }
}
