package com.swarm.ai.remote

import org.json.JSONObject
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class RemoteJsonTest {
    @Test
    fun parsesAgentsListIncludingNullTask() {
        val j = JSONObject(
            """{"agents":[
              {"id":"p1","name":"Builder","status":"running","task":"Compiling","updatedAt":"2026-10-03T14:00:00.000Z"},
              {"id":"p/2","name":"Idle one","status":"idle","task":null,"updatedAt":"2026-10-03T14:00:01.000Z"},
              {"name":"no id"}
            ]}"""
        )
        val agents = RemoteJson.parseAgents(j)
        assertEquals(2, agents.size)
        assertEquals(RemoteAgent("p1", "Builder", "running", "Compiling", "2026-10-03T14:00:00.000Z"), agents[0])
        assertNull(agents[1].task)
        assertEquals("p/2", agents[1].id)
    }

    @Test
    fun missingAgentsArrayGivesEmptyList() {
        assertEquals(emptyList(), RemoteJson.parseAgents(JSONObject("""{"ok":true}""")))
    }

    @Test
    fun pathSegmentsAreUrlEncoded() {
        assertEquals("p%2F2%20x", OkHttpTransport.encodeSegment("p/2 x"))
    }

    @Test
    fun pairingRecordHasNoSecretLeakInHostsRoundTrip() {
        val r = PairingRecord("d", "s", "f".repeat(64), listOf("1.2.3.4:5"), "PC", "1.2.3.4:5")
        assertEquals(r, PairingRecord.fromJson(r.toJson()))
    }
}