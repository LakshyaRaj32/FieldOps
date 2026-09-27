package com.fieldops.mobile

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // FieldOps' own Turbo Modules (location, evidence files) are not autolinked.
          add(FieldOpsPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    createNotificationChannels()
    loadReactNative(this)
  }

  /**
   * Android 8+ shows a notification only in a channel. Push messages from the API name the
   * "jobs" channel (and the manifest makes it FCM's default), so it must exist before the
   * first message arrives, including when the app was never opened since boot. Creating an
   * existing channel is a no-op.
   */
  private fun createNotificationChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel =
      NotificationChannel(
          JOBS_CHANNEL_ID,
          getString(R.string.notification_channel_jobs),
          NotificationManager.IMPORTANCE_HIGH,
        )
        .apply { description = getString(R.string.notification_channel_jobs_description) }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  companion object {
    const val JOBS_CHANNEL_ID = "jobs"
  }
}
