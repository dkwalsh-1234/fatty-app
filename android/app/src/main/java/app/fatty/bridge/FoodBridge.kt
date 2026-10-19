package app.fatty.bridge

import android.content.ActivityNotFoundException
import android.content.Context
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import app.fatty.FattyApp
import app.fatty.FattyConfig
import app.fatty.health.HealthConnect
import app.fatty.widget.FattyWidget
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume

/**
 * `window.FoodBridge`, the contract in docs/android-bridge.md. JavaScript calls arrive on the
 * WebView's bridge thread; the work runs on IO and answers on the main thread through
 * `window.__fattyBridge.resolve(requestId, json)`. Nothing is ever thrown back into JavaScript:
 * failures resolve with `{"error": "..."}`. Calls are only answered while the page in the WebView
 * is the web app itself.
 */
class FoodBridge(
    private val context: Context,
    private val web: WebView,
    private val host: Host,
) {
    interface Host {
        /** The main frame's URL, kept current on the main thread and read from the bridge thread. */
        val pageUrl: String?

        /** Shows Health Connect's permission dialog; [onDone] runs on the main thread when it closes. */
        fun requestHealthPermissions(permissions: Set<String>, onDone: () -> Unit)
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val health = HealthConnect(context)

    private val onOurPage: Boolean get() = FattyConfig.isBase(host.pageUrl)

    @JavascriptInterface
    fun version(): String = if (onOurPage) VERSION else ""

    @JavascriptInterface
    fun syncEntries(requestId: String?, entriesJson: String?) = answer(requestId) {
        health.sync(entriesJson.orEmpty())
    }

    @JavascriptInterface
    fun deleteEntries(requestId: String?, idsJson: String?) = answer(requestId) {
        health.delete(idsJson.orEmpty())
    }

    @JavascriptInterface
    fun readBurn(requestId: String?, days: String?) = answer(requestId) {
        val count = days?.trim()?.toDoubleOrNull()?.toInt()?.takeIf { it > 0 }
            ?: return@answer failure("days must be a whole number above 0")
        // Health Connect only lets an app read 30 days back from when it was first allowed.
        health.readBurn(count.coerceAtMost(MAX_DAYS))
    }

    @JavascriptInterface
    fun updateWidget(summaryJson: String?) {
        if (!onOurPage || summaryJson.isNullOrBlank()) return
        // App scope, so the widget still updates if the activity closes straight after.
        FattyApp.scope(context).launch {
            try {
                FattyWidget.show(context, summaryJson)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                Log.w(TAG, "updateWidget failed", e)
            }
        }
    }

    @JavascriptInterface
    fun healthConnectStatus(requestId: String?) = answer(requestId) { health.status() }

    @JavascriptInterface
    fun requestHealthPermissions(requestId: String?, scope: String?) = answer(requestId) {
        val wanted = HealthConnect.permissionsFor(scope) ?: return@answer failure("scope must be \"write\" or \"read\"")
        // Missing or out of date: the status says so, and the web app offers openHealthConnectSettings().
        if (health.isAvailable() && !health.granted().containsAll(wanted)) {
            withContext(Dispatchers.Main) {
                suspendCancellableCoroutine { cont ->
                    host.requestHealthPermissions(wanted) { if (cont.isActive) cont.resume(Unit) }
                }
            }
        }
        health.status()
    }

    @JavascriptInterface
    fun openHealthConnectSettings() {
        if (!onOurPage) return
        web.post {
            // First one that opens: Fatty's permissions in Health Connect, its home, or the Play Store.
            health.settingsIntents().firstOrNull {
                try {
                    context.startActivity(it)
                    true
                } catch (_: Exception) {
                    false
                }
            }
        }
    }

    /** Stops answering; called when the activity goes. */
    fun close() = scope.cancel()

    private fun answer(requestId: String?, work: suspend () -> JSONObject) {
        if (requestId.isNullOrEmpty() || !onOurPage) return
        scope.launch {
            val result = try {
                work()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ActivityNotFoundException) {
                failure("Health Connect isn't installed")
            } catch (e: Exception) {
                Log.w(TAG, "bridge call failed", e)
                failure(e.message ?: "Something went wrong on the phone")
            }
            withContext(Dispatchers.Main) {
                if (!onOurPage) return@withContext
                val js = "window.__fattyBridge && window.__fattyBridge.resolve(" +
                    JSONObject.quote(requestId) + "," + JSONObject.quote(result.toString()) + ")"
                web.evaluateJavascript(js, null)
            }
        }
    }

    private fun failure(message: String) = JSONObject().put("error", message)

    companion object {
        const val NAME = "FoodBridge"
        const val VERSION = "1"
        private const val MAX_DAYS = 30
        private const val TAG = "FoodBridge"
    }
}
