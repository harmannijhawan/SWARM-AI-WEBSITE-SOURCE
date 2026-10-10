package com.swarm.ai.account

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun AccountApp(client:AccountClient, callback:Uri?, onCompanion:()->Unit) {
    var profile by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var page by remember { mutableStateOf("Chat") }
    var chats by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var current by remember { mutableStateOf<JSONObject?>(null) }
    var prompt by remember { mutableStateOf("") }
    var prefs by remember { mutableStateOf<JSONObject?>(null) }
    var routing by remember { mutableStateOf("auto") }
    val scope=rememberCoroutineScope()
    suspend fun refresh(){profile=client.profile();if(profile!=null){val array=client.call("conversations").getJSONArray("conversations");chats=(0 until array.length()).map { array.getJSONObject(it) }}}
    fun action(work:suspend ()->Unit){scope.launch { loading=true;error=null;try{work()}catch(e:Exception){error=if(e is java.io.IOException)"Network unavailable. Check your connection and retry." else e.message ?: "Request failed. Please retry.";if(runCatching { client.profile() }.getOrNull()==null)profile=null}finally{loading=false} }}
    LaunchedEffect(callback){loading=true;try{if(callback!=null)client.callback(callback);refresh()}catch(e:Exception){error=e.message ?: "Could not connect. Please retry."}finally{loading=false}}
    BackHandler(current!=null || page!="Chat"){current=null;page="Chat"}
    Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background){Column(Modifier.safeDrawingPadding().fillMaxSize().padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
        Image(painterResource(com.swarm.ai.R.drawable.swarm_wordmark),contentDescription="SWARM",modifier=Modifier.width(150.dp).height(35.dp))
        if(loading){LinearProgressIndicator(Modifier.fillMaxWidth());Text("Connecting to SWARM…",fontSize=13.sp)}
        error?.let { Text(it,color=MaterialTheme.colorScheme.error);TextButton(onClick={action{refresh()}},enabled=!loading){Text("Retry") } }
        if(profile==null){Column(Modifier.weight(1f).fillMaxWidth(),verticalArrangement=Arrangement.Center,horizontalAlignment=Alignment.CenterHorizontally){Text("Welcome back",style=MaterialTheme.typography.headlineMedium);Text("Sign in to your SWARM workspace");Spacer(Modifier.height(24.dp));Button(onClick={try{client.begin()}catch(e:Exception){error=e.message}},enabled=!loading){Text("Continue with Google or email")};Text("Sign in or create an account on the secure SWARM website.",modifier=Modifier.padding(16.dp));TextButton(onClick=onCompanion){Text("Connect to my desktop instead")};Text("ONE MISSION. MANY MINDS.",fontSize=11.sp)}}
        else {
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){TextButton(onClick={page="Chat"}){Text("Chat")};TextButton(onClick={page="Settings";action{prefs=client.call("account/preferences");routing=prefs?.optJSONObject("preferences")?.optJSONObject("ai")?.optString("routing","auto") ?: "auto"}}){Text("Settings")};TextButton(onClick=onCompanion){Text("Desktop")}}
            if(page=="Settings"){
                Text(profile?.optString("name")?.takeUnless { it=="null" } ?: "Your SWARM account",style=MaterialTheme.typography.titleLarge);Text(profile?.optString("email").orEmpty());Text("Account connected. Chats and provider configuration belong to this account.")
                Text("Model routing");Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(4.dp)){listOf("auto","fastest","quality").forEach{value->FilterChip(selected=routing==value,onClick={routing=value},label={Text(value)})}}
                Button(enabled=!loading&&prefs!=null,onClick={action{val envelope=prefs!!;val values=envelope.getJSONObject("preferences");val ai=values.optJSONObject("ai") ?: JSONObject();ai.put("routing",routing);values.put("ai",ai);prefs=client.call("account/preferences",JSONObject().put("preferences",values).put("version",envelope.opt("version")));}}){Text("Save routing")}
                Text("Provider keys and advanced account settings are managed on the website. Desktop tool permissions stay on your PC.")
                TextButton(onClick={action{try{client.logout()}finally{profile=null;current=null;chats=emptyList();prefs=null}}},enabled=!loading){Text("Sign out")}
            } else if(current==null){
                Button(onClick={action{current=client.call("conversations",JSONObject().put("title","New chat"));refresh()}},enabled=!loading){Text("New chat")}
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState())){chats.forEach { chat ->TextButton(onClick={action{current=client.call("conversations/"+chat.getString("id"))}},enabled=!loading){Text(chat.optString("title"))} } };if(chats.isEmpty()&&!loading)Text("Start your first conversation.")
            } else {
                Text(current?.optString("title").orEmpty(),style=MaterialTheme.typography.titleMedium)
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(14.dp)){val messages=current?.optJSONArray("messages");if(messages!=null)for(i in 0 until messages.length()){val m=messages.getJSONObject(i);Text(m.optString("role").uppercase(),fontSize=11.sp);Text(m.optString("content"))}}
                OutlinedTextField(value=prompt,onValueChange={prompt=it},label={Text("Message SWARM")},modifier=Modifier.fillMaxWidth(),enabled=!loading)
                Button(enabled=!loading&&prompt.isNotBlank(),onClick={val text=prompt;action{current=client.send(current!!.getString("id"),text);prompt="";refresh()}}){Text("Send")}
            }
        }
    }}
}
