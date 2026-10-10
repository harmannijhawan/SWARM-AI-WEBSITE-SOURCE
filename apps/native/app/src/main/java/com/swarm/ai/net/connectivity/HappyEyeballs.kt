package com.swarm.ai.net.connectivity

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.job

/** One thing the race can try: a direct pinned-HTTPS probe, or a custom transport from a [TransportFactory]. */
interface ConnectAttempt {
    /** Stable id for diagnostics (the host-list entry the attempt came from). */
    val id: String
    /** Human-readable route label ("Home network", "Public IPv6", ...). */
    val label: String
    /** Must return only after the peer was authenticated (pinned fingerprint); throws on any failure. */
    suspend fun run(timeoutMs: Long): AttemptSuccess
}

data class AttemptSuccess(val host: String, val port: Int, val baseUrl: String)

enum class AttemptStatus { SUCCESS, FAILED, CANCELLED, SKIPPED, UNSUPPORTED, INVALID }

data class AttemptReport(
    val id: String,
    val label: String,
    val status: AttemptStatus,
    /** When this attempt started, relative to the start of the race. */
    val startOffsetMs: Long?,
    /** Time until success/failure of this attempt (null for cancelled / skipped). */
    val latencyMs: Long?,
    val errorKind: ProbeErrorKind?,
    val error: String?
)

class RaceResult(
    val winnerIndex: Int?,
    val success: AttemptSuccess?,
    val reports: List<AttemptReport>,
    val totalMs: Long
)

/**
 * Happy-eyeballs style race. Attempt `i` starts [staggerMs] after attempt `i-1` started, or immediately when
 * attempt `i-1` has already failed (so dead routes do not delay later ones). The first success wins, all other
 * attempts are cancelled. Each attempt is capped at [timeoutMs].
 *
 * [clockMs] is injectable for virtual-time tests.
 */
suspend fun raceAttempts(
    attempts: List<ConnectAttempt>,
    staggerMs: Long = 250,
    timeoutMs: Long = 3000,
    clockMs: () -> Long = { System.nanoTime() / 1_000_000 }
): RaceResult {
    val n = attempts.size
    val t0 = clockMs()
    if (n == 0) return RaceResult(null, null, emptyList(), 0)

    val startMs = LongArray(n) { -1 }
    val endMs = LongArray(n) { -1 }
    val status = arrayOfNulls<AttemptStatus>(n)
    val errKind = arrayOfNulls<ProbeErrorKind>(n)
    val errMsg = arrayOfNulls<String>(n)
    val successes = arrayOfNulls<AttemptSuccess>(n)
    val started = List(n) { CompletableDeferred<Unit>() }
    val finished = List(n) { CompletableDeferred<Unit>() }
    val done = Channel<Int>(Channel.UNLIMITED)
    var winner = -1

    coroutineScope {
        for (i in 0 until n) {
            launch {
                if (i > 0) {
                    started[i - 1].await()
                    withTimeoutOrNull(staggerMs) { finished[i - 1].await() }
                }
                startMs[i] = clockMs()
                started[i].complete(Unit)
                try {
                    val r = withTimeoutOrNull(timeoutMs) { attempts[i].run(timeoutMs) }
                    endMs[i] = clockMs()
                    if (r != null) {
                        successes[i] = r
                        status[i] = AttemptStatus.SUCCESS
                    } else {
                        status[i] = AttemptStatus.FAILED
                        errKind[i] = ProbeErrorKind.TIMEOUT
                        errMsg[i] = ProbeErrorKind.TIMEOUT.hint
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (t: Throwable) {
                    endMs[i] = clockMs()
                    status[i] = AttemptStatus.FAILED
                    errKind[i] = ProbeErrors.classify(t)
                    errMsg[i] = ProbeErrors.describe(t)
                }
                if (status[i] == AttemptStatus.FAILED) finished[i].complete(Unit)
                done.send(i)
            }
        }
        var received = 0
        while (received < n) {
            val i = done.receive()
            received++
            if (status[i] == AttemptStatus.SUCCESS) {
                winner = i
                break
            }
        }
        val job = this.coroutineContext.job
        job.children.toList().also { kids -> kids.forEach { it.cancel() } }.joinAll()
    }

    val total = clockMs() - t0
    val reports = attempts.mapIndexed { i, a ->
        val st = status[i] ?: if (started[i].isCompleted) AttemptStatus.CANCELLED else AttemptStatus.SKIPPED
        AttemptReport(
            id = a.id,
            label = a.label,
            status = st,
            startOffsetMs = if (startMs[i] >= 0) startMs[i] - t0 else null,
            latencyMs = if (st == AttemptStatus.SUCCESS || st == AttemptStatus.FAILED) endMs[i] - startMs[i] else null,
            errorKind = errKind[i],
            error = errMsg[i]
        )
    }
    return RaceResult(if (winner >= 0) winner else null, if (winner >= 0) successes[winner] else null, reports, total)
}
