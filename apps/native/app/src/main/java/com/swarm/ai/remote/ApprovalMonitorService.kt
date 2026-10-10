package com.swarm.ai.remote

import android.app.*
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.swarm.ai.MainActivity
import com.swarm.ai.R
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject

/** Keeps the existing authenticated stream alive so real approvals can notify in the background. */
@AndroidEntryPoint
class ApprovalMonitorService : Service() {
    @Inject lateinit var client: RemoteClient
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val notified = mutableSetOf<String>()
    private val eventIds = linkedSetOf<String>()
    private var watch: Job? = null
    private var disconnection: Job? = null
    private var connectedOnce = false
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("swarm-link", "PC connection", NotificationManager.IMPORTANCE_LOW))
        manager.createNotificationChannel(NotificationChannel("swarm-approvals", "SWARM attention and results", NotificationManager.IMPORTANCE_HIGH))
        eventIds.addAll(getSharedPreferences("swarm-notifications", MODE_PRIVATE).getStringSet("events", emptySet()).orEmpty())
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        startForeground(42, NotificationCompat.Builder(this, "swarm-link").setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("SWARM · ${client.pairing.value?.pcName ?: "Your PC"}").setContentText("Connected to your team · listening for results and approvals")
            .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true).build())
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!client.isPaired) { stopSelf(); return START_NOT_STICKY }
        if (watch?.isActive != true) {
            scope.launch { client.pairing.collect { if (it == null) stopSelf() } }
            watch = scope.launch {
                client.events().collect { event ->
                    if (event is WsEvent.Open) {
                        connectedOnce = true; disconnection?.cancel(); disconnection = null
                        getSystemService(NotificationManager::class.java).cancel(43)
                    }
                    if ((event is WsEvent.Failure || event is WsEvent.Closed) && connectedOnce && disconnection?.isActive != true) {
                        disconnection = scope.launch {
                            delay(10_000)
                            if (!client.isPaired || client.socketConnected.value) return@launch
                            val reachable = try { withTimeoutOrNull(5_000) { client.status(); true } ?: false } catch (cancel: CancellationException) { throw cancel } catch (_: Exception) { false }
                            if (!reachable && client.isPaired && !client.socketConnected.value) postNotification(43, "Your PC disconnected", "SWARM will reconnect automatically when the PC is reachable.", WorkspaceLink("pc-disconnected", "pc_disconnected"))
                        }
                    }
                    if (event is WsEvent.AppUpdate && event.channel == "workspace:event") {
                        val json = event.payload as? JSONObject
                        val notice = json?.let(::workNotification)
                        // Approval snapshots below maintain cancellation and avoid duplicate cards.
                        if (notice != null && notice.target.eventType != "approval_required" && eventIds.add(notice.target.id)) {
                            while (eventIds.size > 300) eventIds.remove(eventIds.first())
                            getSharedPreferences("swarm-notifications", MODE_PRIVATE).edit().putStringSet("events", eventIds.toSet()).apply()
                            postNotification(notice.target.id.hashCode(), notice.title, notice.body, notice.target)
                        }
                    }
                    val array = when (event) {
                        is WsEvent.Approvals -> JSONArray(event.approvals)
                        is WsEvent.AppUpdate -> if (event.channel == "approvals:changed") event.payload as? JSONArray else null
                        else -> null
                    } ?: return@collect
                    val pending = (0 until array.length()).mapNotNull { array.optJSONObject(it) }
                    val ids = pending.map { it.optString("id") }.toSet()
                    val manager = getSystemService(NotificationManager::class.java)
                    (notified - ids).forEach { manager.cancel(it.hashCode()); notified.remove(it) }
                    pending.forEach { approval ->
                        val id = approval.optString("id")
                        if (id.isBlank() || !notified.add(id)) return@forEach
                        val owner = approval.optString("runId").takeIf { it.isNotBlank() }
                        postNotification(id.hashCode(), "SWARM needs your approval", approval.optString("title") + "\n" + approval.optString("detail"), WorkspaceLink(id, "approval_required", conversationId = owner?.takeIf { it.startsWith("chat_") }, runId = owner?.takeUnless { it.startsWith("chat_") }, agentRole = approval.optString("agent").takeIf { it.isNotBlank() && it != "manager" }, approvalId = id))
                    }
                }
            }
        }
        return START_STICKY
    }
    private fun postNotification(notificationId: Int, title: String, body: String, target: WorkspaceLink) {
        val open = Intent(this, MainActivity::class.java)
            .putExtra("swarm.workspaceTarget", target.toJson()).putExtra("swarm.approvalId", target.approvalId)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val tap = PendingIntent.getActivity(this, notificationId, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        try {
            getSystemService(NotificationManager::class.java).notify(notificationId, NotificationCompat.Builder(this, "swarm-approvals")
                .setSmallIcon(R.drawable.ic_launcher_foreground).setContentTitle(title)
                .setContentText(body).setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(tap).setAutoCancel(true).setCategory(NotificationCompat.CATEGORY_MESSAGE).build())
        } catch (_: SecurityException) { /* User may revoke notification permission while connected. */ }
    }
    override fun onDestroy() {
        scope.cancel()
        val manager = getSystemService(NotificationManager::class.java)
        notified.forEach { manager.cancel(it.hashCode()) }
        super.onDestroy()
    }
}
