package com.fieldops.mobile.evidence

import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.fieldops.mobile.specs.NativeFieldOpsFilesSpec
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Keeps evidence photos in app-private storage (files/evidence) until they are uploaded.
 * The image picker leaves its result in the cache directory, which Android may clear; a
 * photo captured offline must survive days and app restarts (docs/evidence.md).
 *
 * Every path is confined to files/evidence: names are validated, and deletes of anything
 * outside the directory are refused. Work runs on a single background thread.
 */
class FieldOpsFilesModule(private val context: ReactApplicationContext) :
    NativeFieldOpsFilesSpec(context) {

  private val io: ExecutorService = Executors.newSingleThreadExecutor()

  private val evidenceDir: File
    get() = File(context.filesDir, "evidence").apply { mkdirs() }

  override fun importFile(sourceUri: String, fileName: String, promise: Promise) {
    if (!FILE_NAME.matches(fileName)) {
      promise.reject(INVALID_NAME, "Invalid evidence file name")
      return
    }
    io.execute {
      try {
        val target = File(evidenceDir, fileName)
        val partial = File(evidenceDir, "$fileName.part")
        open(Uri.parse(sourceUri)).use { input ->
          partial.outputStream().use { output -> input.copyTo(output) }
        }
        if (!partial.renameTo(target)) {
          partial.delete()
          throw IOException("Could not move the evidence file into place")
        }
        promise.resolve(
            Arguments.createMap().apply {
              putString("uri", Uri.fromFile(target).toString())
              putDouble("sizeBytes", target.length().toDouble())
            })
      } catch (error: Exception) {
        promise.reject(IMPORT_FAILED, "Could not save the photo on this phone", error)
      }
    }
  }

  override fun fileExists(uri: String, promise: Promise) {
    io.execute { promise.resolve(confined(uri)?.isFile == true) }
  }

  override fun deleteFile(uri: String, promise: Promise) {
    io.execute {
      val file = confined(uri)
      if (file == null) {
        promise.reject(OUTSIDE_EVIDENCE, "Refusing to delete a file outside evidence storage")
        return@execute
      }
      file.delete()
      promise.resolve(null)
    }
  }

  override fun invalidate() {
    io.shutdown()
    super.invalidate()
  }

  private fun open(uri: Uri): InputStream =
      when (uri.scheme) {
        "file" -> FileInputStream(File(requireNotNull(uri.path) { "File URI has no path" }))
        "content" ->
            requireNotNull(context.contentResolver.openInputStream(uri)) {
              "The photo could not be opened"
            }
        else -> throw IOException("Unsupported URI scheme: ${uri.scheme}")
      }

  /** The file a `file://` URI names, if it lies directly inside files/evidence. */
  private fun confined(uri: String): File? {
    val parsed = Uri.parse(uri)
    val path = parsed.path ?: return null
    if (parsed.scheme != "file") return null
    val file = File(path).canonicalFile
    return if (file.parentFile == evidenceDir.canonicalFile) file else null
  }

  companion object {
    const val NAME = NativeFieldOpsFilesSpec.NAME
    private val FILE_NAME = Regex("^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$")
    private const val INVALID_NAME = "INVALID_NAME"
    private const val IMPORT_FAILED = "IMPORT_FAILED"
    private const val OUTSIDE_EVIDENCE = "OUTSIDE_EVIDENCE"
  }
}
