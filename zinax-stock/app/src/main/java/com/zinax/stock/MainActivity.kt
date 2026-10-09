package com.zinax.stock

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.zinax.stock.sync.ReportWorker
import com.zinax.stock.ui.CheckScreen
import com.zinax.stock.ui.HomeScreen
import com.zinax.stock.ui.ImportScreen
import com.zinax.stock.ui.ManualScreen
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

    fun receive(id: String) = "receive/$id"
    fun check(id: String) = "check/$id"
    fun manual(shipmentId: String? = null, pallet: String? = null) =
        "manual?shipmentId=${shipmentId.orEmpty()}&pallet=${android.net.Uri.encode(pallet.orEmpty())}"
}

class MainActivity : ComponentActivity() {
    private var pendingAction by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        pendingAction = intent?.getStringExtra(ReportWorker.EXTRA_ACTION)
        setContent {
            ZinaxTheme {
                val nav = rememberNavController()
                val back: () -> Unit = { nav.popBackStack() }

                LaunchedEffect(pendingAction) {
                    if (pendingAction == ReportWorker.ACTION_SHARE_REPORT) {
                        pendingAction = null
                        Share.toWhatsApp(this@MainActivity, Graph.stockReportText())
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
                    composable(Routes.SHIP_OUT) { ShipOutScreen(onBack = back) }
                    composable(Routes.STOCK) { StockScreen(onBack = back) }
                    composable(Routes.SETTINGS) { SettingsScreen(onBack = back) }
                }

                PrintDialog()
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingAction = intent.getStringExtra(ReportWorker.EXTRA_ACTION)
    }
}
