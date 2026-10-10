package com.swarm.ai

import android.graphics.Bitmap
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.swarm.ai.remote.ui.*
import com.swarm.ai.ui.CompanionShell
import com.swarm.ai.ui.companion.*
import com.swarm.ai.ui.screens.SettingsUiState
import com.swarm.ai.ui.theme.SwarmAITheme
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class CompanionInstrumentedTest {
    @get:Rule val compose = createComposeRule()

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val directory = File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null), "ui-rebuild").apply { mkdirs() }
        val image = compose.onRoot().captureToImage().asAndroidBitmap()
        File(directory, "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun pairingManualEntryUsesRealCallbackAndShowsFailure() {
        var received = ""
        compose.setContent { SwarmAITheme { CompositionLocalProvider(LocalMotion provides false) {
            ConnectionScreen(RemoteUiState(link = LinkMode.OFFLINE, message = "The pairing code has expired.")) { received = it }
        } } }
        compose.onNodeWithText("Connect your SWARM").assertExists()
        screenshot("01-connect")
        compose.onNodeWithText("Enter Manually").performClick()
        compose.onNodeWithText("Pairing code from your PC").performTextInput("actual-payload")
        compose.onNodeWithText("Connect to PC").performScrollTo().performClick()
        assertEquals("actual-payload", received)
        compose.onNodeWithText("The pairing code has expired.").assertExists()
    }

    @Test fun allTabsAgentConversationAndBuildHandoff() {
        var state by mutableStateOf(CompanionState(motion = false, haptics = false))
        var sendText = ""
        var buildRequested = false
        compose.setContent { SwarmAITheme {
            CompanionShell(state, RemoteUiState(paired = true, pcName = "SWARM Desktop", link = LinkMode.LIVE), SettingsUiState(),
                { state = state.copy(prompt = it) }, { state = state.copy(platform = it) }, { buildRequested = true }, {},
                { sendText = it }, {}, {}, { id, role -> state = state.copy(chatId = id, chatRole = role) },
                { motion, haptics -> state = state.copy(motion = motion, haptics = haptics) }, {}, {}, {}, {}, {})
        } }
        compose.onAllNodesWithText("PC Connected")[0].assertExists()
        compose.onNodeWithText("Your coordinator · connected to your PC").assertExists()
        compose.onNodeWithTag("work-drawer-handle").assertExists()
        compose.onNodeWithTag("tab-home").assertDoesNotExist()
        screenshot("02-chat-first")

        compose.onNodeWithTag("tab-chat").performClick()
        screenshot("04-chat-empty")
        compose.onNodeWithText("Ask SWARM anything…").performTextInput("Explain the plan")
        compose.onNodeWithContentDescription("Send message").assertIsDisplayed().performClick()
        assertEquals("Explain the plan", sendText)

        compose.runOnIdle { state = state.copy(runId = "test-run", objective = "Build a timer", runStatus = "running", prompt = "",
            team = desktopAgents.map { TeamMember(it, if (it.id == "coder") "working" else "idle") },
            tasks = listOf(TaskItem("plan", "Plan the application", "planner", "completed"), TaskItem("code", "Build the interface", "coder", "running")),
            messages = listOf(ChatItem("user", "Build a timer", true, "complete"), ChatItem("assistant", "We can create a focused timer with a clean, accessible interface.", false, "complete"))) }
        screenshot("05-chat")
        compose.onNodeWithTag("tab-agents").performClick()
        compose.onNodeWithText("Manager").assertExists()
        compose.onNodeWithText("Manager").performClick()
        compose.onNodeWithText("Chat with Manager").performClick()
        assertEquals("manager", state.chatRole)
        compose.onNodeWithTag("tab-agents").performClick()
        screenshot("06-agents")
        compose.onNodeWithTag("tab-swarm").performClick()
        compose.onNodeWithText("Swarm workspace").assertExists()
        compose.onNodeWithText("LIVE WORK").assertExists()
        compose.onNodeWithText("Agent Map").assertDoesNotExist()
        screenshot("07-live-agent-cards")
        compose.onNodeWithTag("tab-settings").performClick()
        compose.onNodeWithText("Make it yours").assertExists()
        screenshot("08-settings")
        compose.onNodeWithText("Disconnect").performClick()
        compose.onNodeWithText("Stay connected").performClick()
    }

    @Test fun liveWorkUsesFileCountsAndExpandableCommandOutput() {
        var selectedFile = ""
        var remoteOpened = false
        val state = CompanionState(motion = false, computerActive = true,
            files = listOf(WorkFile("real-change-id", "auth.ts", "modified", "coder", 12, 2)),
            workEvents = listOf(
                WorkEvent("start", 1, "command_started", "", agent = "tester", message = "Running tests", status = "running", command = "npm test", operationId = "actual-command-id"),
                WorkEvent("finish", 2, "command_finished", "", agent = "tester", message = "Tests passed", status = "complete", command = "npm test", detail = "42 tests passed", operationId = "actual-command-id")
            ))
        compose.setContent { SwarmAITheme {
            LiveWorkPage(state, {}, { remoteOpened = true }, { selectedFile = it.id }, {}, {})
        } }
        compose.onNodeWithText("SWARM is using your PC").assertExists()
        compose.onNodeWithText("View live PC").performClick()
        assertTrue(remoteOpened)
        compose.onNodeWithText("Tests passed").performScrollTo().performClick()
        compose.onNodeWithText("42 tests passed").assertExists()
        compose.onNodeWithText("Running tests").assertDoesNotExist()
        compose.onNodeWithText("Files").performClick()
        compose.onNodeWithText("auth.ts").assertExists().performClick()
        compose.onNodeWithText("+12").assertExists()
        compose.onNodeWithText("−2").assertExists()
        assertEquals("real-change-id", selectedFile)
        screenshot("09-work-drawer")
    }
}
