package com.rejwan.rejboard.mobile

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.rejwan.rejboard.core.Board
import com.rejwan.rejboard.core.BoardStore
import com.rejwan.rejboard.core.BoardSummary
import com.rejwan.rejboard.core.DriverFactory
import com.rejwan.rejboard.core.Scene
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date

class MainActivity : ComponentActivity() {
    private val store by lazy { BoardStore(DriverFactory(applicationContext).create()) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { MaterialTheme { App(store) } }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun App(store: BoardStore) {
    val scope = rememberCoroutineScope()
    val snack = remember { SnackbarHostState() }
    var boards by remember { mutableStateOf<List<BoardSummary>>(emptyList()) }
    var open by remember { mutableStateOf<Pair<Board, Scene>?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current

    suspend fun refresh() {
        boards = withContext(Dispatchers.IO) {
            store.ensureSample(System.currentTimeMillis())
            store.list()
        }
    }
    LaunchedEffect(Unit) { refresh() }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri != null) scope.launch {
            val msg = withContext(Dispatchers.IO) {
                runCatching {
                    val text = context.contentResolver.openInputStream(uri)!!.use { it.readBytes().decodeToString() }
                    store.importRjwb(text, System.currentTimeMillis())
                }.fold({ null }, { it.message ?: "Could not open that file" })
            }
            refresh()
            msg?.let { snack.showSnackbar(it) }
        }
    }

    open?.let { (board, scene) ->
        BackHandler { open = null }
        Scaffold(topBar = { TopAppBar(title = { Text(board.title) }, actions = { TextButton(onClick = { open = null }) { Text("Close") } }) }) { pad ->
            BoardView(scene, Modifier.padding(pad).fillMaxSize())
        }
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("RejBoard Native (preview)") },
                actions = { TextButton(onClick = { picker.launch(arrayOf("*/*")) }) { Text("Open .rjwb") } },
            )
        },
        snackbarHost = { SnackbarHost(snack) },
    ) { pad ->
        LazyColumn(Modifier.padding(pad).fillMaxSize()) {
            items(boards, key = { it.id }) { b ->
                ListItem(
                    headlineContent = { Text(if (b.locked) "🔒 ${b.title}" else b.title) },
                    supportingContent = {
                        Column {
                            Text("${b.itemCount} items · ${DateFormat.getDateTimeInstance().format(Date(b.updated))}")
                        }
                    },
                    modifier = Modifier.clickable {
                        scope.launch {
                            if (b.locked) { snack.showSnackbar("This board is password-protected. Opening it comes in a later version."); return@launch }
                            val loaded = withContext(Dispatchers.Default) { store.load(b.id)?.let { it to Scene.of(it) } }
                            if (loaded == null) snack.showSnackbar("That board could not be read") else open = loaded
                        }
                    },
                )
                HorizontalDivider()
            }
        }
    }
}
