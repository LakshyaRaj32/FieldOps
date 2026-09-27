import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec of the Kotlin `FieldOpsLocation` Turbo Module
 * (android/app/src/main/java/com/fieldops/mobile/location/FieldOpsLocationModule.kt).
 * This file is the contract between TypeScript and Kotlin; only services/location uses it.
 *
 * Why native code: React Native no longer ships a location API, and the one capability
 * FieldOps needs (one foreground fix on demand, plus "is location switched on?") is a few
 * calls to Android's platform LocationManager. A small module avoids a third-party
 * dependency and Google Play services (docs/location.md, "Native module").
 */
export type LocationFix = {
  latitude: number;
  longitude: number;
  /** Meters (68% confidence radius). Fixes without an accuracy are never returned. */
  accuracyMeters: number;
  /** Epoch milliseconds (UTC) when the fix was taken. */
  timestamp: number;
};

export interface Spec extends TurboModule {
  /** Whether location services are switched on in Android settings (any provider). */
  isLocationEnabled(): boolean;
  /**
   * One fix: a recent one if Android has it (not older than `maximumAgeMs`), otherwise a
   * fresh one within `timeoutMs`. Rejects with the codes PERMISSION_DENIED,
   * SERVICES_DISABLED, UNAVAILABLE or TIMEOUT. Requires the location permission (asked in
   * JavaScript with PermissionsAndroid).
   */
  getCurrentPosition(
    timeoutMs: number,
    maximumAgeMs: number,
  ): Promise<LocationFix>;
  /** Opens the system location settings screen. */
  openLocationSettings(): void;
}

/** Null where the module does not exist (tests, a future iOS build). */
export default TurboModuleRegistry.get<Spec>('FieldOpsLocation');
