package com.fieldops.mobile.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.fieldops.mobile.specs.NativeFieldOpsLocationSpec
import java.util.concurrent.atomic.AtomicBoolean

/**
 * One foreground location fix on demand, on Android's platform LocationManager (no Google
 * Play services). Nothing runs in the background and nothing is stored here: the fix goes
 * back to JavaScript, which decides what to keep (docs/location.md).
 *
 * Permissions are requested in JavaScript (PermissionsAndroid); this module only checks them
 * and reports PERMISSION_DENIED if they are missing.
 */
class FieldOpsLocationModule(private val context: ReactApplicationContext) :
    NativeFieldOpsLocationSpec(context) {

  private val locationManager: LocationManager
    get() = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

  private val mainHandler = Handler(Looper.getMainLooper())

  override fun isLocationEnabled(): Boolean {
    val manager = locationManager
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      manager.isLocationEnabled
    } else {
      manager.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
          manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }
  }

  override fun openLocationSettings() {
    val intent =
        Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  override fun getCurrentPosition(timeoutMs: Double, maximumAgeMs: Double, promise: Promise) {
    val fine = granted(Manifest.permission.ACCESS_FINE_LOCATION)
    val coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION)
    if (!fine && !coarse) {
      promise.reject(PERMISSION_DENIED, "Location permission is not granted")
      return
    }
    if (!isLocationEnabled()) {
      promise.reject(SERVICES_DISABLED, "Location services are switched off")
      return
    }
    val manager = locationManager
    // GPS needs precise permission; the network provider works with approximate too.
    val providers =
        buildList {
              if (fine) add(LocationManager.GPS_PROVIDER)
              add(LocationManager.NETWORK_PROVIDER)
            }
            .filter { manager.isProviderEnabled(it) }
    if (providers.isEmpty()) {
      promise.reject(UNAVAILABLE, "No location provider is available")
      return
    }

    try {
      val recent = recentFix(manager, providers, maximumAgeMs.toLong())
      if (recent != null) {
        promise.resolve(toMap(recent))
        return
      }
      requestFix(manager, providers, timeoutMs.toLong(), promise)
    } catch (error: SecurityException) {
      // The permission was revoked between the check and the call.
      promise.reject(PERMISSION_DENIED, "Location permission is not granted", error)
    }
  }

  private fun granted(permission: String): Boolean =
      context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

  /** The most accurate cached fix no older than [maximumAgeMs], if any. */
  @SuppressLint("MissingPermission") // Checked by the caller.
  private fun recentFix(
      manager: LocationManager,
      providers: List<String>,
      maximumAgeMs: Long,
  ): Location? {
    val now = System.currentTimeMillis()
    return providers
        .mapNotNull { manager.getLastKnownLocation(it) }
        .filter { it.hasAccuracy() && now - it.time in 0..maximumAgeMs }
        .minByOrNull { it.accuracy }
  }

  /**
   * Asks every usable provider for one fix; the first fix with an accuracy wins, the others
   * are cancelled, and TIMEOUT is reported if none arrives in time. The promise settles
   * exactly once.
   */
  @SuppressLint("MissingPermission") // Checked by the caller.
  private fun requestFix(
      manager: LocationManager,
      providers: List<String>,
      timeoutMs: Long,
      promise: Promise,
  ) {
    val settled = AtomicBoolean(false)
    val cancellations = mutableListOf<() -> Unit>()
    lateinit var timeout: Runnable

    fun finish(result: () -> Unit) {
      if (settled.compareAndSet(false, true)) {
        mainHandler.removeCallbacks(timeout)
        cancellations.forEach { cancel -> runCatching { cancel() } }
        result()
      }
    }
    val onFix = { location: Location? ->
      if (location != null && location.hasAccuracy()) {
        finish { promise.resolve(toMap(location)) }
      }
    }
    timeout = Runnable { finish { promise.reject(TIMEOUT, "No location fix in time") } }

    mainHandler.post {
      if (settled.get()) return@post
      try {
        for (provider in providers) {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val signal = CancellationSignal()
            cancellations += { signal.cancel() }
            manager.getCurrentLocation(provider, signal, context.mainExecutor) { onFix(it) }
          } else {
            val listener = SingleUpdateListener(onFix)
            cancellations += { manager.removeUpdates(listener) }
            @Suppress("DEPRECATION")
            manager.requestSingleUpdate(provider, listener, Looper.getMainLooper())
          }
        }
        mainHandler.postDelayed(timeout, timeoutMs.coerceIn(1_000L, 120_000L))
      } catch (error: SecurityException) {
        finish { promise.reject(PERMISSION_DENIED, "Location permission is not granted", error) }
      } catch (error: IllegalArgumentException) {
        finish { promise.reject(UNAVAILABLE, "No location provider is available", error) }
      }
    }
  }

  private class SingleUpdateListener(private val onFix: (Location?) -> Unit) : LocationListener {
    override fun onLocationChanged(location: Location) = onFix(location)

    // Required on API levels below 29, where these have no default implementation.
    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    override fun onProviderEnabled(provider: String) = Unit

    override fun onProviderDisabled(provider: String) = Unit
  }

  private fun toMap(location: Location) =
      Arguments.createMap().apply {
        putDouble("latitude", location.latitude)
        putDouble("longitude", location.longitude)
        putDouble("accuracyMeters", location.accuracy.toDouble())
        putDouble("timestamp", location.time.toDouble())
      }

  companion object {
    const val NAME = NativeFieldOpsLocationSpec.NAME
    private const val PERMISSION_DENIED = "PERMISSION_DENIED"
    private const val SERVICES_DISABLED = "SERVICES_DISABLED"
    private const val UNAVAILABLE = "UNAVAILABLE"
    private const val TIMEOUT = "TIMEOUT"
  }
}
