package com.Mindwhile.neuratalk

import android.content.Intent
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private var linksChannel: MethodChannel? = null
    private var initialLink: String? = null

    /** Only group invite links are handed to the app. */
    private fun inviteLinkOf(intent: Intent?): String? {
        if (intent?.action != Intent.ACTION_VIEW) return null
        val uri = intent.data ?: return null
        val ok = (uri.scheme == "neuratalk" && uri.host == "g") ||
            (uri.scheme == "https" && (uri.host == "neuratalk.in" || uri.host == "www.neuratalk.in") && (uri.path ?: "").startsWith("/g/"))
        return if (ok) uri.toString() else null
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        initialLink = inviteLinkOf(intent)
        linksChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "neuratalk/links").apply {
            setMethodCallHandler { call, result ->
                if (call.method == "initialLink") {
                    result.success(initialLink)
                    initialLink = null
                } else result.notImplemented()
            }
        }
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "neuratalk/ongoing_call").setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "start" -> {
                        val intent = Intent(this, OngoingCallService::class.java)
                            .putExtra(OngoingCallService.EXTRA_VIDEO, call.argument<Boolean>("video") ?: false)
                            .putExtra(OngoingCallService.EXTRA_PEER, call.argument<String>("peer"))
                            .putExtra(OngoingCallService.EXTRA_SCREEN, call.argument<Boolean>("screen") ?: false)
                        ContextCompat.startForegroundService(this, intent)
                        result.success(true)
                    }
                    "stop" -> {
                        startService(Intent(this, OngoingCallService::class.java).setAction(OngoingCallService.ACTION_STOP))
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            } catch (e: Exception) {
                result.error("ONGOING_CALL", e.message, null)
            }
        }
    }

    // App already open (singleTask): a tapped link arrives here.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        inviteLinkOf(intent)?.let { linksChannel?.invokeMethod("link", it) }
    }
}
