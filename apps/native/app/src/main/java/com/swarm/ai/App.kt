package com.swarm.ai

import android.app.Application
import com.swarm.ai.data.repository.SwarmRepository
import dagger.hilt.android.HiltAndroidApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltAndroidApp
class App : Application() {

    @Inject
    lateinit var swarmRepository: SwarmRepository

    private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        appScope.launch {
            try {
                swarmRepository.seedIfEmpty()
            } catch (e: Exception) {
                android.util.Log.e("SwarmAI", "Seeding failed", e)
            }
        }
    }
}