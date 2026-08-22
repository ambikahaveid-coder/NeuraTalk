# NeuraTalk thin WebView shell.
-keep class io.flutter.** { *; }
-dontwarn io.flutter.embedding.**

# flutter_callkit_incoming -- native call-UI plugin, obfuscating its
# classes breaks the incoming-call notification/activity at runtime.
-keep class com.hiennv.flutter_callkit_incoming.** { *; }
