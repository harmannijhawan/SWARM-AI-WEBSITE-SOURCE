package com.swarm.ai.ui.companion

import org.json.JSONObject
import org.junit.Test
import kotlin.test.*

class WorkspaceEventsTest {
    @Test fun liveDeliveryAndReplayDoNotDuplicateFileChanges() {
        val created = parseWorkEvent(JSONObject("""{"id":"file-1","sequence":3,"ts":10,"type":"file_modified","agent":"coder","message":"Edited auth.ts","data":{"path":"auth.ts","changeId":"change-1","additions":12,"deletions":2}}"""))!!
        val running = parseWorkEvent(JSONObject("""{"id":"command-1","sequence":2,"type":"command_started","message":"Running tests"}"""))!!
        val merged = mergeWorkEvents(listOf(created), listOf(running, created))
        assertEquals(listOf("command-1", "file-1"), merged.map { it.id })
        assertEquals(12, merged.last().additions)
        assertEquals("change-1", merged.last().changeId)
    }

    @Test fun absentDiffCountsStayUnknown() {
        val event = parseWorkEvent(JSONObject("""{"id":"f","sequence":1,"type":"file_created","message":"Created file","data":{"path":"Home.kt"}}"""))!!
        assertNull(event.additions)
        assertNull(event.deletions)
        val file = parseWorkFile(JSONObject("""{"id":"f","path":"Home.kt","kind":"created"}"""))
        assertNull(file.additions)
        assertNull(file.deletions)
    }

    @Test fun completedOperationReplacesItsRunningCardAndOlderReplayCannotRevertIt() {
        val start = WorkEvent("start", 1, "command_started", "", status = "running", operationId = "cmd-1")
        val finish = WorkEvent("finish", 2, "command_finished", "", status = "complete", operationId = "cmd-1")
        assertEquals(listOf(finish), workActivity(listOf(start, finish)))
        assertEquals(listOf(finish), mergeWorkEvents(listOf(finish), listOf(finish.copy(sequence = 1, status = "running"))))
    }

    @Test fun privateReasoningAndUnknownEventTypesNeverEnterActivity() {
        assertNull(parseWorkEvent(JSONObject("""{"id":"private","type":"AGENT_THINKING","message":"private"}""")))
        assertNull(parseWorkEvent(JSONObject("""{"id":"tokens","type":"reasoning_delta","message":"private"}""")))
        assertNull(parseWorkEvent(JSONObject("""{"type":"tool_started","message":"Missing id"}""")))
    }

    @Test fun authoritativeNestedAgentAndTaskStateAreAvailableImmediately() {
        val agent = parseWorkEvent(JSONObject("""{"id":"a","sequence":2,"type":"agent_status","agent":"coder","status":"complete","message":"Coder waiting","data":{"agent":{"status":"blocked","taskTitle":"Login fix"}}}"""))!!
        assertEquals("blocked", agent.agentStatus)
        assertEquals("Login fix", agent.agentTask)
        val task = parseWorkEvent(JSONObject("""{"id":"t","sequence":3,"type":"task_failed","message":"Test failed","data":{"task":{"id":"task-1","title":"Test login","role":"tester","status":"failed","error":"401 response"}}}"""))!!.task!!
        assertEquals("failed", task.status)
        assertEquals("401 response", task.output)
    }

    @Test fun awaySummaryCountsRealDistinctFilesAndCompletedCommands() {
        val events = listOf(
            WorkEvent("1", 1, "file_modified", "", path = "auth.ts"),
            WorkEvent("2", 2, "file_modified", "", path = "auth.ts"),
            WorkEvent("3", 3, "command_finished", ""),
            WorkEvent("4", 4, "task_completed", "")
        )
        assertEquals("1 file changed · 1 task completed · 1 command finished · 1 approval waiting", workSummary(events, 1))
    }

    @Test fun streamedUserEchoIsReconciledAndScreenshotSurvivesUpdates() {
        val local = ChatItem("local-1", "Check my PC", true, "sending")
        val waiting = ChatItem("local-1-thinking", "", false, "streaming")
        val user = ChatItem("server-user", "Check my PC", true, "complete")
        val echoed = mergeChatTurn(listOf(local, waiting), user)
        assertEquals(1, echoed.count { it.user })
        val first = ChatItem("assistant", "Looking", false, "streaming", tools = listOf(ToolItem("shot", "computer.screenshot", "Taking screenshot", "complete", preview = "data:image/jpeg;base64,actual")))
        val updated = first.copy(text = "Your browser is open", status = "complete", tools = first.tools.map { it.copy(preview = "") })
        val final = mergeChatTurn(mergeChatTurn(echoed, first), updated)
        assertFalse(final.any { it.id.endsWith("-thinking") })
        assertEquals("data:image/jpeg;base64,actual", final.last().tools.single().preview)
    }
}
