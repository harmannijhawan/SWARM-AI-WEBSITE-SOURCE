package com.swarm.ai.remote

import java.nio.ByteBuffer
import org.junit.Test
import org.junit.Assert.*

class DesktopFrameCodecTest {
    private fun packet(): ByteArray = ByteBuffer.allocate(34)
        .putInt(0x53574446).put(1).put(1).putShort(28).putInt(42)
        .putShort(1920).putShort(1080).putLong(1791130000000).putInt(6)
        .put(byteArrayOf(0xff.toByte(), 0xd8.toByte(), 1, 2, 0xff.toByte(), 0xd9.toByte())).array()

    @Test fun decodesDesktopPacket() {
        val frame = DesktopFrameCodec.decode(packet())!!
        assertEquals(1920, frame.width)
        assertEquals(1080, frame.height)
        assertEquals(42, frame.sequence)
        assertEquals(1791130000000, frame.timestamp)
        assertEquals(0xff.toByte(), frame.jpegData[0])
        assertEquals(6, frame.jpegData.size)
    }
    @Test fun rejectsTruncatedInvalidAndLegacyPackets() {
        val p = packet()
        for (size in 0 until p.size) assertNull(DesktopFrameCodec.decode(p.copyOf(size)))
        p[24] = 1
        assertNull(DesktopFrameCodec.decode(p))
        assertNull(DesktopFrameCodec.decode(ByteArray(100)))
    }
}
