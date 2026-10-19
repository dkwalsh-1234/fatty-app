package app.fatty.web

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebChromeClient.FileChooserParams
import androidx.core.content.FileProvider
import java.io.File

/**
 * The web app's file inputs. An image input with `capture="environment"` opens the camera
 * straight away (meal and label photos); anything else opens the system picker.
 */
object FileChooser {

    private const val DIR = "camera"
    private const val KEEP_MS = 60 * 60 * 1000L

    /** The input has a `capture` attribute and takes images. */
    fun wantsCamera(params: FileChooserParams): Boolean {
        if (!params.isCaptureEnabled) return false
        val types = params.acceptTypes.orEmpty().map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        return types.isEmpty() || types.any { it == "*/*" || it.startsWith("image/") }
    }

    /**
     * A fresh content:// uri in the cache for the camera app to write to. Shots older than an hour
     * are cleared first; the web app has long since read them.
     */
    fun newPhotoUri(context: Context): Uri {
        val dir = File(context.cacheDir, DIR).apply { mkdirs() }
        val cutoff = System.currentTimeMillis() - KEEP_MS
        dir.listFiles()?.filter { it.lastModified() < cutoff }?.forEach { it.delete() }
        val file = File(dir, "photo-${System.currentTimeMillis()}.jpg")
        return FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    }

    fun pickerIntent(params: FileChooserParams): Intent = params.createIntent().apply {
        if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
    }

    /** Reads every picked item from ClipData, which `FileChooserParams.parseResult` misses on some WebView versions. */
    fun parseResult(resultCode: Int, data: Intent?): Array<Uri>? {
        if (resultCode != Activity.RESULT_OK || data == null) return null
        val clip = data.clipData
        if (clip != null && clip.itemCount > 0) {
            val uris = (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
            if (uris.isNotEmpty()) return uris.toTypedArray()
        }
        return data.data?.let { arrayOf(it) }
    }
}
