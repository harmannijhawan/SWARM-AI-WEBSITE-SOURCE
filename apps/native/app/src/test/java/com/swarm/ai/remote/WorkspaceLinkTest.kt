package com.swarm.ai.remote

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WorkspaceLinkTest {
    @Test fun destinationRoundTripsWithoutLosingConversationOrAgent() {
        val target = WorkspaceLink("event", "task_failed", "chat", "run", "tester", "approval")
        assertEquals(target, WorkspaceLink.parse(target.toJson()))
        assertNull(WorkspaceLink.parse("invalid"))
    }
    @Test fun routineToolsAndIndividualTaskSuccessStayQuiet() {
        assertNull(workNotification(JSONObject().put("id", "tool").put("type", "tool_started")))
        assertNull(workNotification(JSONObject().put("id", "task").put("type", "task_completed").put("taskId", "subtask").put("data", JSONObject().put("sourceType", "TASK_COMPLETED"))))
    }
    @Test fun completionAndFailuresCarryExactTargets() {
        val notice = workNotification(JSONObject().put("id", "done").put("type", "task_completed").put("message", "Tests passed").put("conversationId", "chat").put("runId", "run").put("data", JSONObject().put("sourceType", "RUN_COMPLETED")))!!
        assertEquals("chat", notice.target.conversationId)
        assertEquals("run", notice.target.runId)
        assertEquals("Tests passed", notice.body)
    }
}
