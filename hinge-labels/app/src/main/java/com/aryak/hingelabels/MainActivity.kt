package com.aryak.hingelabels

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import com.aryak.hingelabels.ui.HingeTheme
import com.aryak.hingelabels.ui.MainScreen
import com.aryak.hingelabels.ui.PrintDialog
import com.aryak.hingelabels.ui.SettingsScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            HingeTheme {
                var settings by rememberSaveable { mutableStateOf(false) }
                BackHandler(enabled = settings) { settings = false }
                if (settings) SettingsScreen(onBack = { settings = false })
                else MainScreen(onSettings = { settings = true })
                PrintDialog()
            }
        }
    }
}
