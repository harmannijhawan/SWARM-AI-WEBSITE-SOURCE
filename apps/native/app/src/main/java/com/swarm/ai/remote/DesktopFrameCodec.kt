package com.swarm.ai.remote

import java.nio.ByteBuffer
import java.nio.ByteOrder

object DesktopFrameCodec {
    fun decode(data: ByteArray): WsEvent.DesktopFrame? {
        if (data.size < 28 || data.size > 8 * 1024 * 1024) return null
        val b = ByteBuffer.wrap(data).order(ByteOrder.BIG_ENDIAN)
        if (b.int != 0x53574446 || b.get().toInt() != 1 || b.get().toInt() != 1 || b.short.toInt() != 28) return null
        val sequence = b.int
        val width = b.short.toInt() and 0xffff
        val height = b.short.toInt() and 0xffff
        val timestamp = b.long
        val length = b.int
        if (width !in 1..4096 || height !in 1..4096 || length != data.size - 28 || length < 4) return null
        if (data[28] != 0xff.toByte() || data[29] != 0xd8.toByte()) return null
        return WsEvent.DesktopFrame(sequence, width, height, data.copyOfRange(28, data.size), timestamp)
    }
}
