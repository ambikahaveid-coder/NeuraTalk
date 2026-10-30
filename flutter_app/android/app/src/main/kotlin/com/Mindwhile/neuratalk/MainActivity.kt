package com.Mindwhile.neuratalk

import android.content.Intent
import androidx.core.content.ContextCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "neuratalk/ongoing_call").setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "start" -> {
                        val intent = Intent(this, OngoingCallService::class.java)
                            .putExtra(OngoingCallService.EXTRA_VIDEO, call.argument<Boolean>("video") ?: false)
                            .putExtra(OngoingCallService.EXTRA_PEER, call.argument<String>("peer"))
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
}
