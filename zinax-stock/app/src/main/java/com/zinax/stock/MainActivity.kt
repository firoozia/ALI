package com.zinax.stock

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.fragment.app.FragmentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.zinax.stock.sync.ReportWorker
import com.zinax.stock.sync.RequestNotifier
import com.zinax.stock.ui.LockScreen
import com.zinax.stock.ui.MoveScanScreen
import com.zinax.stock.ui.ReceiveScanScreen
import com.zinax.stock.ui.StockCountScreen
import com.zinax.stock.ui.LowStockScreen
import com.zinax.stock.sync.LowStockNotifier
import com.zinax.stock.ui.ItemHistoryScreen
import com.zinax.stock.ui.RequestsScreen
import com.zinax.stock.ui.UsersScreen
import com.zinax.stock.ui.CatalogScreen
import com.zinax.stock.ui.CheckScreen
import com.zinax.stock.ui.CustomersScreen
import com.zinax.stock.ui.CutScreen
import com.zinax.stock.ui.HomeScreen
import com.zinax.stock.ui.ImportScreen
import com.zinax.stock.ui.ManualScreen
import com.zinax.stock.ui.ReportsScreen
import com.zinax.stock.ui.PrintDialog
import com.zinax.stock.ui.ReceiveScreen
import com.zinax.stock.ui.SettingsScreen
import com.zinax.stock.ui.ShipOutScreen
import com.zinax.stock.ui.ShipmentsScreen
import com.zinax.stock.ui.StockScreen
import com.zinax.stock.ui.theme.ZinaxTheme

object Routes {
    const val HOME = "home"
    const val IMPORT = "import"
    const val SHIPMENTS = "shipments"
    const val RECEIVE = "receive/{shipmentId}"
    const val CHECK = "check/{shipmentId}"
    const val MANUAL = "manual?shipmentId={shipmentId}&pallet={pallet}"
    const val SHIP_OUT = "shipout"
    const val STOCK = "stock"
    const val SETTINGS = "settings"
    const val OUT_REPORT = "outreport"
    const val CUT = "cut?item={item}"
    const val CUSTOMERS = "customers"
    const val USERS = "users"
    const val MOVE_SCAN = "movescan"
    const val RECEIVE_SCAN = "receivescan"
    const val COUNT = "count"
    const val LOW = "lowstock"
    const val HISTORY = "history?id={id}"

    fun history(id: String? = null) = "history?id=${android.net.Uri.encode(id.orEmpty())}"
    const val CATALOG = "catalog"
    const val REQUESTS = "requests?open={open}&act={act}"

    fun requests(open: String? = null, act: String? = null) = "requests?open=${open.orEmpty()}&act=${act.orEmpty()}"

    fun cut(itemId: String? = null) = "cut?item=${android.net.Uri.encode(itemId.orEmpty())}"

    fun receive(id: String) = "receive/$id"
    fun check(id: String) = "check/$id"
    fun manual(shipmentId: String? = null, pallet: String? = null) =
        "manual?shipmentId=${shipmentId.orEmpty()}&pallet=${android.net.Uri.encode(pallet.orEmpty())}"
}

/** A notification button waiting to be handled once someone has signed in. */
private data class OpenRequest(val id: String, val action: String)

class MainActivity : FragmentActivity() {
    private var pendingAction by mutableStateOf<String?>(null)
    private var openRequest by mutableStateOf<OpenRequest?>(null)
    private var openLow by mutableStateOf(false)

    private fun readIntent(intent: Intent?) {
        pendingAction = intent?.getStringExtra(ReportWorker.EXTRA_ACTION)
        val id = intent?.getStringExtra(RequestNotifier.EXTRA_REQUEST)
        if (intent?.getBooleanExtra(LowStockNotifier.EXTRA_OPEN_LOW, false) == true) openLow = true
        if (id != null) openRequest = OpenRequest(id, intent?.getStringExtra(RequestNotifier.EXTRA_REQUEST_ACTION) ?: RequestNotifier.OPEN)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        readIntent(intent)

        // While the app is on screen, check the sheet every 20 s so requests and approvals arrive quickly.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    try { Graph.sync.syncIfChanged() } catch (_: Exception) {}
                    delay(20_000)
                }
            }
        }
        // Lock after the idle time set by an admin.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) {
                    if (Graph.session.current != null && Graph.session.idleTooLong()) Graph.session.lock()
                    delay(10_000)
                }
            }
        }

        setContent {
            ZinaxTheme {
                // The language counts as safe once the screens have run on it for a few seconds.
                LaunchedEffect(com.zinax.stock.ui.UiLang.lang) { delay(5000); Graph.prefs.languagePending = false }
                val nav = rememberNavController()
                val back: () -> Unit = { nav.popBackStack() }
                val user by Graph.session.user.collectAsStateWithLifecycle()
                val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}

                LaunchedEffect(pendingAction, user) {
                    if (user != null && pendingAction == ReportWorker.ACTION_SHARE_REPORT) {
                        pendingAction = null
                        Graph.shareStockReport(this@MainActivity)
                    }
                }
                LaunchedEffect(openLow, user) {
                    if (!openLow || user == null) return@LaunchedEffect
                    openLow = false
                    nav.navigate(Routes.LOW)
                }
                LaunchedEffect(openRequest, user) {
                    val r = openRequest ?: return@LaunchedEffect
                    if (user == null) return@LaunchedEffect
                    openRequest = null
                    RequestNotifier.cancel(this@MainActivity, r.id)
                    nav.navigate(Routes.requests(r.id, r.action))
                }
                // Approvals arrive as notifications, which Android 13+ must allow.
                LaunchedEffect(user) {
                    if (user != null && Build.VERSION.SDK_INT >= 33 && !Graph.prefs.askedNotifications &&
                        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                    ) {
                        Graph.prefs.askedNotifications = true
                        Graph.session.leaving()
                        notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                }

                NavHost(navController = nav, startDestination = Routes.HOME) {
                    composable(Routes.HOME) { HomeScreen(nav) }
                    composable(Routes.IMPORT) { ImportScreen(onBack = back, onSaved = { id ->
                        nav.navigate(Routes.receive(id)) { popUpTo(Routes.IMPORT) { inclusive = true } }
                    }) }
                    composable(Routes.SHIPMENTS) { ShipmentsScreen(nav, onBack = back) }
                    composable(Routes.RECEIVE, listOf(navArgument("shipmentId") { type = NavType.StringType })) {
                        ReceiveScreen(it.arguments?.getString("shipmentId").orEmpty(), nav, onBack = back)
                    }
                    composable(Routes.CHECK, listOf(navArgument("shipmentId") { type = NavType.StringType })) {
                        CheckScreen(it.arguments?.getString("shipmentId").orEmpty(), nav, onBack = back)
                    }
                    composable(
                        Routes.MANUAL,
                        listOf(
                            navArgument("shipmentId") { type = NavType.StringType; defaultValue = "" },
                            navArgument("pallet") { type = NavType.StringType; defaultValue = "" },
                        ),
                    ) {
                        ManualScreen(
                            shipmentId = it.arguments?.getString("shipmentId").orEmpty().ifEmpty { null },
                            pallet = it.arguments?.getString("pallet").orEmpty().ifEmpty { null },
                            onBack = back,
                        )
                    }
                    composable(Routes.SHIP_OUT) { ShipOutScreen(onBack = back, onReport = { nav.navigate(Routes.OUT_REPORT) }) }
                    composable(Routes.STOCK) {
                        StockScreen(onBack = back, onCut = { id -> nav.navigate(Routes.cut(id)) }, onMoveScan = { nav.navigate(Routes.MOVE_SCAN) }, onCount = { nav.navigate(Routes.COUNT) }, onHistory = { id -> nav.navigate(Routes.history(id)) })
                    }
                    composable(Routes.SETTINGS) { SettingsScreen(onBack = back, onCustomers = { nav.navigate(Routes.CUSTOMERS) }, onUsers = { nav.navigate(Routes.USERS) }, onCatalog = { nav.navigate(Routes.CATALOG) }) }
                    composable(Routes.CUT, listOf(navArgument("item") { type = NavType.StringType; defaultValue = "" })) {
                        CutScreen(startItem = it.arguments?.getString("item").orEmpty().ifEmpty { null }, onBack = back)
                    }
                    composable(Routes.CUSTOMERS) { CustomersScreen(onBack = back) }
                    composable(Routes.USERS) { UsersScreen(onBack = back) }
                    composable(Routes.MOVE_SCAN) { MoveScanScreen(onBack = back) }
                    composable(Routes.RECEIVE_SCAN) { ReceiveScanScreen(onBack = back) }
                    composable(Routes.COUNT) { StockCountScreen(onBack = back) }
                    composable(Routes.LOW) { LowStockScreen(onBack = back, onCatalog = { nav.navigate(Routes.CATALOG) }) }
                    composable(Routes.HISTORY, listOf(navArgument("id") { type = NavType.StringType; defaultValue = "" })) {
                        ItemHistoryScreen(it.arguments?.getString("id").orEmpty(), onBack = back)
                    }
                    composable(Routes.CATALOG) { CatalogScreen(onBack = back) }
                    composable(
                        Routes.REQUESTS,
                        listOf(
                            navArgument("open") { type = NavType.StringType; defaultValue = "" },
                            navArgument("act") { type = NavType.StringType; defaultValue = "" },
                        ),
                    ) {
                        RequestsScreen(
                            onBack = back,
                            openId = it.arguments?.getString("open").orEmpty().ifEmpty { null },
                            openAction = it.arguments?.getString("act").orEmpty().ifEmpty { null },
                        )
                    }
                    composable(Routes.OUT_REPORT) { ReportsScreen(onBack = back) }
                }

                PrintDialog()
                if (user == null) LockScreen()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        readIntent(intent)
    }

    override fun onUserInteraction() {
        super.onUserInteraction()
        Graph.session.touch()
    }

    override fun onStart() {
        super.onStart()
        if (Graph.session.idleTooLong()) Graph.session.lock()
        Graph.session.expectingExternal = false
    }

    /** Leaving the app locks it (if set), unless the app itself opened the camera, share sheet or file picker. */
    override fun onStop() {
        super.onStop()
        if (!isChangingConfigurations && !Graph.session.expectingExternal && Graph.prefs.lockOnLeave) Graph.session.lock()
    }
}
