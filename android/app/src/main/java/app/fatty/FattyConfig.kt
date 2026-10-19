package app.fatty

import android.content.Intent
import android.net.Uri
import androidx.core.net.toUri

/**
 * The web app's address, from fatty.properties via BuildConfig. Everything that decides "is this
 * our page?" (links, camera grants, the bridge, intents) goes through [isBase].
 */
object FattyConfig {

    /** Intent extra carrying a path on the web app, e.g. `/log/scan`. */
    const val EXTRA_ROUTE = "route"

    /** e.g. `https://fatty.example.app`, never with a trailing slash. */
    val BASE_URL: String = BuildConfig.FATTY_BASE_URL.trim().trimEnd('/')

    val isConfigured: Boolean get() = BASE_URL.isNotEmpty() && baseOrigin != null

    private val base: Uri? = BASE_URL.takeIf { it.isNotEmpty() }?.toUri()

    /** `https://host[:port]`, lower-cased, or null if the base URL isn't a usable http(s) address. */
    val baseOrigin: String? = base?.let(::originOf)

    /** Origin of an http(s) [uri], with the port only when it isn't the scheme's default. */
    fun originOf(uri: Uri): String? {
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "https" && scheme != "http") return null
        val host = uri.host?.lowercase()?.takeIf { it.isNotEmpty() } ?: return null
        val port = uri.port.takeIf { it != -1 && it != if (scheme == "https") 443 else 80 }
        return if (port == null) "$scheme://$host" else "$scheme://$host:$port"
    }

    /** True for http(s) URLs on the web app's origin. */
    fun isBase(uri: Uri?): Boolean = uri != null && baseOrigin != null && originOf(uri) == baseOrigin

    fun isBase(url: String?): Boolean = url != null && isBase(url.toUri())

    /** Full URL for a path on the web app, or null if [route] isn't a plain path there. */
    fun urlForRoute(route: String?): String? {
        val path = route?.trim()?.takeIf { it.startsWith("/") && !it.startsWith("//") } ?: return null
        return "$BASE_URL$path".takeIf { isBase(it) }
    }

    /**
     * The page an incoming Intent asks for: [EXTRA_ROUTE], or a URL on the web app's origin as the
     * Intent's data. Anything else is ignored, so other apps can't point the WebView elsewhere.
     */
    fun urlFromIntent(intent: Intent?): String? {
        if (intent == null) return null
        urlForRoute(intent.getStringExtra(EXTRA_ROUTE))?.let { return it }
        return intent.dataString?.takeIf { isBase(it) }
    }
}
