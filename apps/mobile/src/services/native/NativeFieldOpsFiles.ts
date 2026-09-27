import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Codegen spec of the Kotlin `FieldOpsFiles` Turbo Module
 * (android/app/src/main/java/com/fieldops/mobile/evidence/FieldOpsFilesModule.kt).
 *
 * Why native code: a photo from the camera or gallery arrives as a file in the app's cache,
 * which Android may clear at any time. Evidence waiting to upload must survive until the
 * server has it, so it is copied into app-private storage (files/evidence). React Native has
 * no file-system API, and three small functions do not justify a file-system library
 * (docs/evidence.md, "On the device").
 */
export type ImportedFile = {
  /** `file://` URI of the copy in app-private storage. */
  uri: string;
  sizeBytes: number;
};

export interface Spec extends TurboModule {
  /**
   * Copies `sourceUri` (`file://` or `content://`) to files/evidence/`fileName`. The name is
   * restricted to [A-Za-z0-9._-] (the evidence ID plus an extension).
   */
  importFile(sourceUri: string, fileName: string): Promise<ImportedFile>;
  /** Whether a file under files/evidence exists. */
  fileExists(uri: string): Promise<boolean>;
  /** Deletes a file under files/evidence (anything else is refused). Idempotent. */
  deleteFile(uri: string): Promise<void>;
}

export default TurboModuleRegistry.get<Spec>('FieldOpsFiles');
