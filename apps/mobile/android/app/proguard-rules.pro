# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in the Android SDK's proguard-android-optimize.txt.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-config reads BuildConfig fields reflectively.
-keep class com.fieldops.mobile.BuildConfig { *; }
