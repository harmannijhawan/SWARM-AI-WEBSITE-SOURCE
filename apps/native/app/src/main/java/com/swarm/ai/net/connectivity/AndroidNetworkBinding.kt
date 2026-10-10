package com.swarm.ai.net.connectivity

import android.content.Context
import android.net.ConnectivityManager
import okhttp3.Dns
import java.net.Inet6Address
import java.net.InetAddress

/**
 * Android-only helpers (need ACCESS_NETWORK_STATE, already declared in the manifest). All functions are
 * best-effort and return null / "unknown" instead of throwing.
 */
object AndroidNetworks {
    fun prefersLocal(context: Context): Boolean = try {
        val cm = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val caps = cm?.activeNetwork?.let { cm.getNetworkCapabilities(it) }
        caps?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_CELLULAR) != true
    } catch (_: Exception) { true }
    /**
     * Binds probes to the currently active network (incl. VPN). Optional: by default the process-wide default
     * network is used, which is the same thing on a normal setup. Use it when you re-run the race right after a
     * network change and want to be sure sockets and DNS use the new network, not a stale one.
     */
    fun bindToActiveNetwork(context: Context): NetworkBinding? = try {
        val cm = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val net = cm?.activeNetwork
        if (net == null) null else NetworkBinding(net.socketFactory, object : Dns {
            override fun lookup(hostname: String): List<InetAddress> = net.getAllByName(hostname).toList()
        }, net.networkHandle.toString())
    } catch (_: Exception) {
        null
    }

    /** True/false when the active network has / lacks a global (non link-local, non ULA) IPv6 address; null if unknown. */
    fun hasGlobalIpv6(context: Context): Boolean? = try {
        val cm = context.applicationContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val lp = cm?.activeNetwork?.let { cm.getLinkProperties(it) }
        lp?.linkAddresses?.any { la -> Ipv6Support.isGlobalIpv6(la.address) }
    } catch (_: Exception) {
        null
    }
}

/** JVM-only IPv6 detection (java.net), usable without a Context. */
object Ipv6Support {
    fun isGlobalIpv6(a: InetAddress): Boolean {
        if (a !is Inet6Address) return false
        if (a.isLoopbackAddress || a.isLinkLocalAddress || a.isSiteLocalAddress || a.isAnyLocalAddress || a.isMulticastAddress) return false
        return (a.address[0].toInt() and 0xfe) != 0xfc // unique-local fc00::/7
    }

    /**
     * Whether this device currently has any global IPv6 address. Returns true when it cannot tell (so we never
     * wrongly demote IPv6 candidates).
     */
    fun detect(): Boolean = try {
        val ifs = java.net.NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
        val addrs = ifs.filter { it.isUp && !it.isLoopback }.flatMap { it.inetAddresses.toList() }
        if (ifs.isEmpty()) true else addrs.any { isGlobalIpv6(it) }
    } catch (_: Exception) {
        true
    }
}
