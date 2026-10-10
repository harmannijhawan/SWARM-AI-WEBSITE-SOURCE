package com.swarm.ai

import androidx.arch.core.executor.testing.InstantTaskExecutorRule
import com.swarm.ai.data.repository.SwarmRepository
import com.swarm.ai.model.Agent
import com.swarm.ai.model.AiModel
import com.swarm.ai.model.SwarmSettings
import com.swarm.ai.ui.screens.AgentsViewModel
import com.swarm.ai.ui.screens.BuildViewModel
import com.swarm.ai.ui.screens.HomeViewModel
import com.swarm.ai.ui.screens.ModelsViewModel
import com.swarm.ai.ui.screens.SettingsViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.mockito.Mockito.*
import org.mockito.kotlin.any
import org.mockito.kotlin.whenever
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class ViewModelTest {

    @get:Rule
    val instantExecutorRule = InstantTaskExecutorRule()

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var repository: SwarmRepository

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        repository = mock(SwarmRepository::class.java)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun testHomeViewModel() = runTest {
        whenever(repository.getAgents()).thenReturn(flowOf(listOf(Agent(id = "1", name = "TestAgent", role = "Worker", status = "Idle"))))
        whenever(repository.getModels()).thenReturn(flowOf(listOf(AiModel(id = "m1", name = "Model 1", provider = "Local", size = "1GB", downloaded = true))))
        whenever(repository.getSettings()).thenReturn(flowOf(SwarmSettings(selectedModelId = "m1", localInferenceEnabled = true)))

        val viewModel = HomeViewModel(repository)
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals(1, viewModel.uiState.value.activeAgentsCount)
        assertEquals("Model 1", viewModel.uiState.value.selectedModelName)
    }

    @Test
    fun testModelsViewModel() = runTest {
        val models = listOf(AiModel(id = "m1", name = "Model 1", provider = "Local", size = "1GB", downloaded = true))
        whenever(repository.getModels()).thenReturn(flowOf(models))

        val viewModel = ModelsViewModel(repository)
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals(models, viewModel.uiState.value.models)
    }

    @Test
    fun testAgentsViewModel() = runTest {
        val agents = listOf(Agent(id = "1", name = "Agent 1", role = "Planner", status = "Active"))
        whenever(repository.getAgents()).thenReturn(flowOf(agents))

        val viewModel = AgentsViewModel(repository)
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals(agents, viewModel.uiState.value.agents)
    }

    @Test
    fun testBuildViewModel() = runTest {
        whenever(repository.getAgents()).thenReturn(flowOf(emptyList()))
        val viewModel = BuildViewModel(repository)
        
        viewModel.updatePrompt("Analyze data")
        assertEquals("Analyze data", viewModel.uiState.value.prompt)

        viewModel.executeTask()
        testDispatcher.scheduler.advanceUntilIdle()
        assertTrue(viewModel.uiState.value.isExecuting)
    }

    @Test
    fun testSettingsViewModel() = runTest {
        val settings = SwarmSettings(temperature = 0.7f, localInferenceEnabled = true)
        whenever(repository.getSettings()).thenReturn(flowOf(settings))

        val viewModel = SettingsViewModel(repository)
        testDispatcher.scheduler.advanceUntilIdle()

        assertEquals(0.7f, viewModel.uiState.value.temperature)
        assertTrue(viewModel.uiState.value.localInferenceEnabled)
    }
}
