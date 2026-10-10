package com.swarm.ai.account

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Native credentials remain encrypted with a non-exportable Android Keystore key. */
class AccountClient(private val context: Context) {
    private val origin = "https://www.swarmgpt.online"
    private val prefs = context.getSharedPreferences("swarm-account", Context.MODE_PRIVATE)
    private val http = OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(200, TimeUnit.SECONDS).callTimeout(240, TimeUnit.SECONDS).followRedirects(false).build()
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey("swarm-account-v1", null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("swarm-account-v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private fun save(name: String, value: String?) {
        if(value == null) { prefs.edit().remove(name).commit(); return }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encoded = Base64.encodeToString(cipher.iv + cipher.doFinal(value.toByteArray()), Base64.NO_WRAP)
        check(prefs.edit().putString(name, encoded).commit()) { "Could not save the secure session." }
    }
    private fun read(name: String): String? {
        val encoded = prefs.getString(name, null) ?: return null
        val bytes = Base64.decode(encoded, Base64.NO_WRAP)
        return Cipher.getInstance("AES/GCM/NoPadding").run { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0,12))); String(doFinal(bytes.copyOfRange(12,bytes.size))) }
    }
    private fun random() = Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    private fun sha(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
    fun begin() {
        val state=random(); val verifier=random()
        save("pending", JSONObject().put("state",state).put("verifier",verifier).put("expires",System.currentTimeMillis()+300000).toString())
        val challenge=Base64.encodeToString(sha(verifier),Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        val uri=Uri.parse("$origin/desktop/connect").buildUpon().appendQueryParameter("platform","android").appendQueryParameter("callback","swarm-ai://auth/callback").appendQueryParameter("state",state).appendQueryParameter("challenge",challenge).build()
        context.startActivity(Intent(Intent.ACTION_VIEW,uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    suspend fun callback(uri: Uri) {
        require(uri.scheme=="swarm-ai" && uri.host=="auth" && uri.path=="/callback") { "Invalid sign-in callback." }
        val pending=read("pending")?.let(::JSONObject) ?: error("Sign-in expired. Please try again.")
        require(pending.getLong("expires")>System.currentTimeMillis() && pending.getString("state")==uri.getQueryParameter("state")) { "Sign-in expired or does not match this device." }
        val code=uri.getQueryParameter("code") ?: error("Missing sign-in grant.")
        save("pending",null)
        val result=call("account/desktop-token",JSONObject().put("code",code).put("verifier",pending.getString("verifier")),authenticated=false)
        save("token",result.getString("token"))
    }
    suspend fun profile(): JSONObject? = if(read("token")==null) null else call("account/profile")
    suspend fun logout() {
        val token=read("token")
        try { if(token!=null) call("account/revoke",JSONObject().put("id",sha(token).joinToString("") { "%02x".format(it) })) } finally { save("token",null);save("pending",null) }
    }
    suspend fun call(path:String, body:JSONObject?=null, authenticated:Boolean=true):JSONObject = withContext(Dispatchers.IO) {
        val builder=Request.Builder().url("$origin/api/$path")
        if(authenticated)builder.header("Authorization","Bearer "+(read("token") ?: error("Sign in to continue.")))
        if(body!=null)builder.post(body.toString().toRequestBody("application/json".toMediaType()))
        http.newCall(builder.build()).execute().use { response ->
            val text=response.body?.string().orEmpty()
            if(response.code==401 && authenticated)save("token",null)
            val data=runCatching { JSONObject(text) }.getOrNull()
            check(response.isSuccessful) { data?.optString("error")?.takeIf { it.isNotBlank() } ?: "Account service unavailable (${response.code}). Please retry." }
            data ?: error("The service returned an unreadable response.")
        }
    }
    suspend fun send(id:String,prompt:String):JSONObject = withContext(Dispatchers.IO) {
        val payload=JSONObject().put("action","send").put("prompt",prompt).put("modelId","auto").put("providerId","auto").put("mode","chat")
        val request=Request.Builder().url("$origin/api/conversations/$id/stream").header("Authorization","Bearer "+(read("token") ?: error("Sign in to continue."))).post(payload.toString().toRequestBody("application/json".toMediaType())).build()
        http.newCall(request).execute().use { response ->
            if(response.code==401)save("token",null)
            check(response.isSuccessful) { "Chat request failed (${response.code}). Check your connection and provider settings." }
            val source=response.body?.source() ?: error("No response received.")
            var event=""; var failure:String?=null
            while(!source.exhausted()) { val line=source.readUtf8Line() ?: break
                if(line.startsWith("event:"))event=line.removePrefix("event:").trim()
                if(line.startsWith("data:") && event=="error")failure=runCatching { JSONObject(line.removePrefix("data:").trim()).optString("error") }.getOrDefault("The model request failed.")
            }
            if(failure!=null)error(failure)
        }
        call("conversations/$id")
    }
}
