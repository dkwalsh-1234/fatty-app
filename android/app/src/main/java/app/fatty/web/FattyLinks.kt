package app.fatty.web

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import app.fatty.FattyConfig
import java.net.URISyntaxException

/**
 * Decides which WebView navigations leave the app (from Keep's KeepLinks). http(s) on the web
 * app's origin stays in the WebView; other hosts, mailto:, tel:, intent: and the rest open in
 * whatever app handles them. about:, javascript:, data: and blob: are left to the WebView.
 */
object FattyLinks {

    private val webViewSchemes = setOf("about", "javascript", "data", "blob")

    /** True if [uri] was handed to another app (or swallowed); false means "let the WebView load it". */
    fun handleExternally(context: Context, uri: Uri): Boolean {
        val scheme = uri.scheme?.lowercase() ?: return false
        when (scheme) {
            "http", "https" -> if (FattyConfig.isBase(uri)) return false else openExternal(context, uri)
            in webViewSchemes -> return false
            "intent" -> openIntentUri(context, uri.toString())
            else -> openExternal(context, uri) // mailto:, tel:, market:, ...
        }
        return true
    }

    /** ACTION_VIEW in a new task. Returns false if no app can handle it. */
    fun openExternal(context: Context, uri: Uri): Boolean = try {
        context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (_: ActivityNotFoundException) {
        Log.i("FattyLinks", "No app for ${uri.scheme}: link")
        false
    }

    /** `intent://…#Intent;…;end` links, sanitised (browsable only, no explicit component). */
    private fun openIntentUri(context: Context, raw: String): Boolean {
        val intent = try {
            Intent.parseUri(raw, Intent.URI_INTENT_SCHEME)
        } catch (_: URISyntaxException) {
            return false
        }
        intent.addCategory(Intent.CATEGORY_BROWSABLE)
        intent.component = null
        intent.selector = null
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
            return true
        } catch (_: ActivityNotFoundException) {
        }
        val fallback = intent.getStringExtra("browser_fallback_url")?.let(Uri::parse) ?: return false
        val s = fallback.scheme?.lowercase()
        return (s == "http" || s == "https") && openExternal(context, fallback)
    }
}
