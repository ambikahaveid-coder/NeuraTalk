# Keep React Native and NeuraTalk native bridge classes intact for telecom runtime stability.
-keep class com.facebook.react.** { *; }
-keep class com.neuratalk.** { *; }
-dontwarn com.facebook.react.**
