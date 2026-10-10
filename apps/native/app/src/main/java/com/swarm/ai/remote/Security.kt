package com.swarm.ai.remote

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Everything needed to talk to a paired PC. [deviceSecret] is only ever persisted encrypted. */
data class PairingRecord(
    val deviceId: String,
    val deviceSecret: String,
    val fingerprint: String,
    val hosts: List<String>,
    val pcName: String,
    val lastRoute: String? = null
) {
    fun toJson(): String = JSONObject()
        .put("deviceId", deviceId).put("deviceSecret", deviceSecret).put("fp", fingerprint)
        .put("hosts", JSONArray(hosts)).put("pcName", pcName).put("lastRoute", lastRoute ?: JSONObject.NULL)
        .toString()

    companion object {
        fun fromJson(s: String): PairingRecord {
            val o = JSONObject(s)
            val arr = o.getJSONArray("hosts")
            return PairingRecord(
                deviceId = o.getString("deviceId"),
                deviceSecret = o.getString("deviceSecret"),
                fingerprint = o.getString("fp"),
                hosts = (0 until arr.length()).map { arr.getString(it) },
                pcName = o.optString("pcName", "PC"),
                lastRoute = if (o.isNull("lastRoute")) null else o.optString("lastRoute")
            )
        }
    }
}

private const val ANDROID_KEYSTORE = "AndroidKeyStore"

/** Per-pairing non-exportable ECDSA P-256 key in the Android Keystore. */
class DeviceKey(private val deviceId: String) {
    private val alias get() = "swarm_device_key_$deviceId"

    private fun ks(): KeyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    /** Creates the key pair if needed and returns the X.509 SPKI public key (base64, standard, padded). */
    fun ensurePublicKeyB64(): String {
        val store = ks()
        if (!store.containsAlias(alias)) {
            val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, ANDROID_KEYSTORE)
            gen.initialize(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .build()
            )
            gen.generateKeyPair()
        }
        return Codec.b64(ks().getCertificate(alias).publicKey.encoded)
    }

    fun signer(): Signer = Signer { data ->
        val key = ks().getKey(alias, null) as PrivateKey
        Signature.getInstance("SHA256withECDSA").run {
            initSign(key)
            update(data)
            sign()
        }
    }

    fun delete() {
        try {
            val store = ks()
            if (store.containsAlias(alias)) store.deleteEntry(alias)
        } catch (_: Exception) {
        }
    }
}

/** Stores the [PairingRecord] AES-GCM encrypted with a Keystore-held key inside private SharedPreferences. */
class PairingStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences("swarm_remote", Context.MODE_PRIVATE)
    private val wrapAlias = "swarm_pairing_wrap_key"

    private fun wrapKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getKey(wrapAlias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(wrapAlias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return gen.generateKey()
    }

    fun load(): PairingRecord? {
        val blob = prefs.getString("record", null) ?: return null
        return try {
            val raw = Base64.decode(blob, Base64.NO_WRAP)
            val iv = raw.copyOfRange(0, 12)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, wrapKey(), GCMParameterSpec(128, iv))
            PairingRecord.fromJson(String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8))
        } catch (e: Exception) {
            null
        }
    }

    fun save(record: PairingRecord) {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, wrapKey())
        val ct = c.doFinal(record.toJson().toByteArray(Charsets.UTF_8))
        prefs.edit().putString("record", Base64.encodeToString(c.iv + ct, Base64.NO_WRAP)).apply()
    }

    fun clear() {
        prefs.edit().remove("record").apply()
    }
}