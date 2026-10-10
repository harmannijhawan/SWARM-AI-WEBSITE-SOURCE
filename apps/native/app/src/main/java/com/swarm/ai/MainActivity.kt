package com.swarm.ai

import android.os.Bundle
import android.content.Intent
import android.os.Build
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.MutableStateFlow
import com.swarm.ai.remote.RemoteClient
import com.swarm.ai.remote.ApprovalMonitorService
import com.swarm.ai.remote.WorkspaceLink
import javax.inject.Inject
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.swarm.ai.ui.SwarmApp
import com.swarm.ai.ui.theme.SwarmAITheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    private lateinit var account: com.swarm.ai.account.AccountClient
    private val authCallback = MutableStateFlow<android.net.Uri?>(null)
    @Inject lateinit var client: RemoteClient
    private val approval = MutableStateFlow<String?>(null)
    private val target = MutableStateFlow<WorkspaceLink?>(null)
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted && client.isPaired) startMonitor() }
    private fun startMonitor() { ContextCompat.startForegroundService(this, Intent(this, ApprovalMonitorService::class.java)) }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        account = com.swarm.ai.account.AccountClient(this)
        authCallback.value = intent.data
        approval.value = intent.getStringExtra("swarm.approvalId")
        target.value = WorkspaceLink.parse(intent.getStringExtra("swarm.workspaceTarget"))
        lifecycleScope.launch {
            client.pairing.collect { paired ->
                if (paired != null) {
                    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                        val prefs = getSharedPreferences("companion-ui", MODE_PRIVATE)
                        if (!prefs.getBoolean("notificationAsked", false)) { prefs.edit().putBoolean("notificationAsked", true).apply(); notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }
                    } else startMonitor()
                } else stopService(Intent(this@MainActivity, ApprovalMonitorService::class.java))
            }
        }
        setContent {
            SwarmAITheme {
                val id by approval.collectAsStateWithLifecycle()
                val destination by target.collectAsStateWithLifecycle()
                val callback by authCallback.collectAsStateWithLifecycle()
                var companion by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
                androidx.activity.compose.BackHandler(companion) { companion = false }
                if(companion) SwarmApp(id, destination) else com.swarm.ai.account.AccountApp(account, callback, { companion = true })
            }
        }
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent); setIntent(intent)
        authCallback.value = intent.data
        approval.value = intent.getStringExtra("swarm.approvalId")
        target.value = WorkspaceLink.parse(intent.getStringExtra("swarm.workspaceTarget"))
    }
}
