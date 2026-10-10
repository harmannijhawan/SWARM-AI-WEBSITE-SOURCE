package com.swarm.ai.ui.companion

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.swarm.ai.remote.RemoteClient
import com.swarm.ai.net.connectivity.*
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import javax.inject.Inject

@HiltViewModel
class DiagnosticsViewModel @Inject constructor(private val client: RemoteClient) : ViewModel() {
    val results = MutableStateFlow<List<RouteDiagnostic>>(emptyList())
    val busy = MutableStateFlow(false)
    val error = MutableStateFlow<String?>(null)
    fun run(context: android.content.Context) {
        if (busy.value) return
        val record = client.pairing.value ?: return
        busy.value = true; error.value = null
        viewModelScope.launch {
            try { results.value = diagnoseConnection(context.applicationContext, record) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { error.value = e.message }
            finally { busy.value = false }
        }
    }
}
@Composable
fun DiagnosticsPage(onClose: () -> Unit, vm: DiagnosticsViewModel = hiltViewModel()) {
    val results by vm.results.collectAsStateWithLifecycle()
    val busy by vm.busy.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Row { Text("Connection diagnostics", Modifier.weight(1f), fontSize = 18.sp, fontWeight = FontWeight.Bold); TextButton(onClick = onClose) { Text("Close") } } }
        item { Text("Tests from this phone's active network. Turn off Wi-Fi and run again to verify public IPv6.", fontSize = 12.sp, color = Muted) }
        item { PrimaryAction(if (busy) "Testing network path…" else "Run diagnostics", enabled = !busy, busy = busy) { vm.run(context) } }
        error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
        items(results) { result -> SoftCard {
            Text(result.endpoint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            result.steps.forEach { step -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(step.status, fontSize = 10.sp, fontWeight = FontWeight.Bold, color = if (step.status == "FAIL") MaterialTheme.colorScheme.error else if (step.status == "PASS") androidx.compose.ui.graphics.Color(0xFF15995A) else Muted, modifier = Modifier.width(56.dp))
                Column { Text(step.layer, fontSize = 12.sp); Text(step.detail, fontSize = 10.sp, color = Muted) }
            } }
        } }
    }
}
