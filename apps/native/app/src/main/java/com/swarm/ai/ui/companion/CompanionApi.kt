package com.swarm.ai.ui.companion

import com.swarm.ai.remote.RemoteClient
import javax.inject.Inject

/** Uses the same pinned, network-aware authenticated transport as Remote PC. */
class CompanionApi @Inject constructor(private val connection: RemoteClient) {
    suspend fun invoke(channel: String, vararg args: Any): Any? = connection.invoke(channel, args.toList())
}
