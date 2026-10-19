package app.fatty

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.health.connect.client.PermissionController
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import app.fatty.bridge.FoodBridge
import app.fatty.health.HealthConnect
import app.fatty.web.FattyLinks
import app.fatty.web.FileChooser

/**
 * Fatty's web app in a WebView. The web app is the real interface; this adds what a browser tab
 * can't: Health Connect and the widget through [FoodBridge], the camera for barcode scanning and
 * photos, and widget buttons that open straight onto a route.
 */
class MainActivity : ComponentActivity(), FoodBridge.Host {

    private lateinit var web: WebView
    private var bridge: FoodBridge? = null
    private lateinit var back: OnBackPressedCallback

    @Volatile
    override var pageUrl: String? = null
        private set

    private var pendingFiles: ValueCallback<Array<Uri>>? = null
    private var pendingPhoto: Uri? = null
    /** A capture input waiting on the camera permission. */
    private var captureParams: WebChromeClient.FileChooserParams? = null
    /** A getUserMedia request waiting on the camera permission. */
    private var pendingMedia: PermissionRequest? = null
    private var healthDone: (() -> Unit)? = null
    private var stoppedAt = 0L
    /** Off to the camera, a picker or a permission dialog: coming back isn't "after a long while". */
    private var awaitingResult = false
    private var webGone = false

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        deliverFiles(FileChooser.parseResult(result.resultCode, result.data))
    }

    private val takePhoto = registerForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        val photo = pendingPhoto
        pendingPhoto = null
        deliverFiles(if (saved && photo != null) arrayOf(photo) else null)
    }

    private val askCamera = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingMedia?.let { if (granted) it.grant(VIDEO) else it.deny() }
        pendingMedia = null
        // Denied: the picker still lets them choose a photo they already have.
        captureParams?.let { if (granted) launchCamera(it) else launchPicker(it) }
        captureParams = null
    }

    private val askHealth = registerForActivityResult(PermissionController.createRequestPermissionResultContract(HealthConnect.PROVIDER)) {
        healthDone?.invoke()
        healthDone = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Pine behind both bars in both themes, with light icons, matching the web app's theme-color.
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        val root = FrameLayout(this).apply { setBackgroundColor(getColor(R.color.system_bar)) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        if (!FattyConfig.isConfigured) {
            root.addView(TextView(this).apply {
                text = getString(R.string.app_not_configured)
                setTextColor(getColor(R.color.on_bar))
                gravity = Gravity.CENTER
                setPadding(64, 64, 64, 64)
            }, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            setContentView(root)
            return
        }

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web = WebView(this).apply {
            setBackgroundColor(getColor(R.color.page_bg))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // The scanner's <video> starts from script once the camera stream arrives.
            settings.mediaPlaybackRequiresUserGesture = false
            settings.userAgentString = settings.userAgentString + " FattyApp/1"
            // The web app has its own dark theme; the DayNight theme feeds prefers-color-scheme.
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)
            }
            webViewClient = Client()
            webChromeClient = ChromeClient()
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, false)
        }
        bridge = FoodBridge(this, web, this).also { web.addJavascriptInterface(it, FoodBridge.NAME) }
        root.addView(web, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)

        // Back walks the WebView's history; at the start of it, Android's own back takes over.
        back = object : OnBackPressedCallback(false) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        }
        onBackPressedDispatcher.addCallback(this, back)

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            load(FattyConfig.urlFromIntent(intent) ?: "${FattyConfig.BASE_URL}/")
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // A widget button or a link to the web app: open that page in the WebView already running.
        if (::web.isInitialized) FattyConfig.urlFromIntent(intent)?.let(::load)
    }

    override fun onResume() {
        super.onResume()
        // Back after a long while: show fresh data rather than what was on screen hours ago.
        val away = if (stoppedAt == 0L) 0L else SystemClock.elapsedRealtime() - stoppedAt
        stoppedAt = 0L
        awaitingResult = false
        if (::web.isInitialized && away > STALE_AFTER_MS) web.reload()
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    override fun onStop() {
        super.onStop()
        stoppedAt = if (awaitingResult) 0L else SystemClock.elapsedRealtime()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (::web.isInitialized && !webGone) web.saveState(outState)
    }

    override fun onDestroy() {
        bridge?.close()
        pendingMedia?.deny()
        pendingFiles?.onReceiveValue(null)
        if (::web.isInitialized && !webGone) web.destroy()
        super.onDestroy()
    }

    override fun requestHealthPermissions(permissions: Set<String>, onDone: () -> Unit) {
        // One dialog at a time; a second ask just gets the current answer.
        if (healthDone != null) return onDone()
        healthDone = onDone
        awaitingResult = true
        try {
            askHealth.launch(permissions)
        } catch (_: ActivityNotFoundException) {
            healthDone = null
            onDone()
        }
    }

    private fun load(url: String) {
        stoppedAt = 0L
        web.loadUrl(url)
    }

    private fun hasCamera() = checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    private fun deliverFiles(uris: Array<Uri>?) {
        pendingFiles?.onReceiveValue(uris)
        pendingFiles = null
    }

    private fun launchCamera(params: WebChromeClient.FileChooserParams) {
        val photo = FileChooser.newPhotoUri(this)
        pendingPhoto = photo
        awaitingResult = true
        try {
            takePhoto.launch(photo)
        } catch (_: ActivityNotFoundException) {
            pendingPhoto = null
            launchPicker(params)
        }
    }

    private fun launchPicker(params: WebChromeClient.FileChooserParams) {
        awaitingResult = true
        try {
            pickFiles.launch(FileChooser.pickerIntent(params))
        } catch (_: ActivityNotFoundException) {
            deliverFiles(null)
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
            request.isForMainFrame && FattyLinks.handleExternally(this@MainActivity, request.url)

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            pageUrl = url
        }

        // Also fires for the web app's client-side route changes.
        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            pageUrl = url
            back.isEnabled = view.canGoBack()
        }

        override fun onPageFinished(view: WebView, url: String?) {
            pageUrl = view.url
            back.isEnabled = view.canGoBack()
            CookieManager.getInstance().flush()
        }

        // The renderer crashed or was killed for memory: start over instead of taking the app down.
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            webGone = true
            pageUrl = null
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
            recreate()
            return true
        }
    }

    private inner class ChromeClient : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            pendingFiles?.onReceiveValue(null)
            pendingFiles = callback
            when {
                !FileChooser.wantsCamera(params) -> launchPicker(params)
                hasCamera() -> launchCamera(params)
                else -> {
                    captureParams = params
                    awaitingResult = true
                    askCamera.launch(Manifest.permission.CAMERA)
                }
            }
            return true
        }

        // getUserMedia for the live barcode scanner: camera only, and only for the web app itself.
        override fun onPermissionRequest(request: PermissionRequest) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE !in request.resources || !FattyConfig.isBase(request.origin)) {
                request.deny()
                return
            }
            if (hasCamera()) {
                request.grant(VIDEO)
            } else {
                pendingMedia?.deny()
                pendingMedia = request
                awaitingResult = true
                askCamera.launch(Manifest.permission.CAMERA)
            }
        }

        override fun onPermissionRequestCanceled(request: PermissionRequest) {
            if (pendingMedia == request) pendingMedia = null
        }
    }

    private companion object {
        const val STALE_AFTER_MS = 30 * 60 * 1000L
        val VIDEO = arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
    }
}
