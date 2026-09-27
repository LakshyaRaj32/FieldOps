import NativeFieldOpsFiles from '../native/NativeFieldOpsFiles';

/**
 * Durable storage for evidence photos waiting to be uploaded (app-private files/evidence,
 * through the FieldOpsFiles native module). SQLite keeps the metadata and the outbox; the
 * bytes stay on disk, never in the database (docs/evidence.md, "On the device").
 */
export interface EvidenceFiles {
  /** Copies a picked or captured photo into durable storage. */
  importPhoto(
    sourceUri: string,
    fileName: string,
  ): Promise<{ readonly uri: string; readonly sizeBytes: number }>;
  exists(uri: string): Promise<boolean>;
  remove(uri: string): Promise<void>;
}

export class EvidenceFilesUnavailableError extends Error {
  override readonly name = 'EvidenceFilesUnavailableError';
}

function nativeModule() {
  if (NativeFieldOpsFiles === null) {
    throw new EvidenceFilesUnavailableError(
      'Evidence storage is not available on this platform',
    );
  }
  return NativeFieldOpsFiles;
}

export const evidenceFiles: EvidenceFiles = {
  importPhoto: (sourceUri, fileName) =>
    nativeModule().importFile(sourceUri, fileName),
  exists: uri => nativeModule().fileExists(uri),
  remove: uri => nativeModule().deleteFile(uri),
};
