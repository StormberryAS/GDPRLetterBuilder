package no.stormberry.gdprletterbuilder

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.CalendarContract
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.OutputStream
import java.util.concurrent.ExecutorService
import java.util.TimeZone
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * One screen: a WebView running the bundled web app, which is the same set of files that
 * gdpr.stormberry.as serves. Kotlin adds only what a browser would otherwise provide, and checks
 * everything the page asks of it (OutgoingRequest, SaveName, CalendarEvent, NavigationPolicy):
 *  - Copy: Android's clipboard, the text always marked sensitive (AND-1);
 *  - Share: Android's share sheet with the text;
 *  - Save as text file and Save a reminder: Android's save screen (Storage Access Framework, so
 *    no storage permission), under the page's own neutral file name;
 *  - Add to calendar app: Android's calendar insert intent for the reminder (no permission);
 *  - Print or save as PDF: Android's print screen with the text the page would print, because
 *    window.print() does nothing inside the WebView (LetterPrintAdapter);
 *  - Open email app: the page's mailto: link handed to the email app (NavigationPolicy);
 *  - the source links: the user's browser, never inside the app;
 *  - the privacy page and the disclaimer: a second WebView over the letter, so Back returns to
 *    the letter as it was (E3-1);
 *  - Back on the letter: the page asks first when something is typed, in its own dialog (E3-1).
 * The letters are written in the page, exactly as on the website. The app has no permission at
 * all, not even INTERNET, so nothing can leave the device unless the person sends it somewhere.
 */
class MainActivity : ComponentActivity() {

    private lateinit var container: FrameLayout
    private var webView: WebView? = null
    private lateinit var assetLoader: WebViewAssetLoader

    private val main = Handler(Looper.getMainLooper())
    private val io: ExecutorService = Executors.newSingleThreadExecutor()

    // The privacy page or the disclaimer, open over the letter (E3-1). No bridge, no script.
    private var sidePage: WebView? = null

    // The letter page's end of the channel, from its latest message (the bridge says hello as it
    // starts), so the app can tell it about Back and a missing email app.
    private var pageProxy: JavaScriptReplyProxy? = null
    private var bridgeSupported = false

    // A debug build (the page can be inspected, and the calendar intent's times are logged).
    private var debuggable = false

    // Back was handed to the page, which has not answered yet; if it never does, the app asks itself.
    private var backWatchdog: Runnable? = null

    // Which Back query the page may still answer, so only one dialog can ever ask (BackQuery).
    private val backQuery = BackQuery()

    // The app's own "Close the app?" dialog, while it is open.
    private var closeDialog: AlertDialog? = null

    // Set once "The app stopped and reloaded" has been shown for this start, so it is said once.
    private var crashNoticeShown = false

    /**
     * The file waiting while Android's save screen is open, with the request it answers and the
     * page that asked. In memory only: if Android ends the app while the save screen is open, the
     * file is gone and the app says it stopped (page_crashed), rather than a letter being written
     * into saved state. A page that only reloaded after its renderer stopped keeps it (A3-2).
     */
    private class PendingSave(val bytes: ByteArray, val id: Int, val proxy: JavaScriptReplyProxy)

    private var pendingSave: PendingSave? = null

    private val saveText = registerForActivityResult(ActivityResultContracts.CreateDocument(SaveName.TEXT)) { onSaveTarget(it) }
    private val saveCalendar = registerForActivityResult(ActivityResultContracts.CreateDocument(SaveName.CALENDAR)) { onSaveTarget(it) }

    override fun onCreate(savedInstanceState: Bundle?) {
        val page = ContextCompat.getColor(this, R.color.page_background)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(page),
            navigationBarStyle = SystemBarStyle.dark(page),
        )
        super.onCreate(savedInstanceState)

        debuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(NavigationPolicy.ASSET_HOST)
            .setHttpAllowed(false)
            .addPathHandler("/", WebAssetHandler(assets, logMisses = debuggable))
            .build()

        // Debugging the page from a desktop browser is for debug builds only.
        WebView.setWebContentsDebuggingEnabled(debuggable)
        CookieManager.getInstance().setAcceptCookie(false)

        container = FrameLayout(this).apply { setBackgroundColor(page) }
        setContentView(container)
        ViewCompat.setOnApplyWindowInsetsListener(container) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        createWebView()

        // Android ended the app while it was in the background (the save screen open, say) and has
        // started it again: the page starts empty, and the person is told why (E3-5).
        if (savedInstanceState != null) {
            crashNoticeShown = true
            toast(R.string.page_crashed)
        }

        onBackPressedDispatcher.addCallback(this, object : androidx.activity.OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = onBack()
        })
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // A text size change in Android's settings while the app is open (E3-3): the activity is
        // kept (configChanges), so the WebViews are told the new size here.
        webView?.let { applyTextZoom(it) }
        sidePage?.let { applyTextZoom(it) }
    }

    /**
     * Android's text size for the page, as a percentage (200 at the largest font scale). textZoom
     * enlarges the letters and leaves the page's rem spacing as it is. EclipseTracker moved to a
     * larger default font size instead (its fix C, S-2); that was tried here and measured worse
     * (17 October 2026): this page's gutters, card and field padding are in rem, so they grew too,
     * and on a 320 dp screen the date in a timeline row was cut from 1.5, and at 2.0 the dates and
     * the selects in the rows showed three or four characters and Remove stood outside its card.
     * Keep textZoom on both WebViews. tests/app-mode-smoke.ts enlarges the text this way.
     */
    private fun applyTextZoom(view: WebView) {
        view.settings.textZoom = (resources.configuration.fontScale * 100).roundToInt().coerceIn(50, 300)
    }

    // ---------------------------------------------------------------- Back

    /**
     * Back closes the privacy page or the disclaimer (going back within them first). On the letter
     * it is handed to the page, which closes its own dialog if one is open, asks "Close the app?"
     * in its own dialog when something is typed, and otherwise tells the app to close (E3-1). If
     * the page cannot be asked (a WebView too old for the channel) or does not answer, the app
     * asks in a dialog of its own, with the same words. Each Back is a numbered query
     * ([BackQuery]): the page opens its dialog only after the app agrees, and the app stops
     * agreeing once it has asked itself, so a late answer from a busy page cannot open a second
     * dialog (stage 3 verification, the Back timing race).
     */
    private fun onBack() {
        sidePage?.let { side ->
            if (side.canGoBack()) side.goBack() else closeSidePage()
            return
        }
        if (backQuery.isWaiting || closeDialog != null) return
        val proxy = pageProxy
        if (proxy == null) {
            // The page has not started its bridge: nothing can have been typed yet, unless the
            // WebView has no channel at all.
            if (bridgeSupported) finish() else askBeforeClosing()
            return
        }
        val q = backQuery.start()
        if (q == 0) return
        val watchdog = Runnable {
            backWatchdog = null
            if (backQuery.timedOut(q)) askBeforeClosing()
        }
        backWatchdog = watchdog
        main.postDelayed(watchdog, BACK_ANSWER_MS)
        post(proxy, JSONObject().put("t", "back").put("q", q))
    }

    /** The page's answer about Back: stay, close or ask, with the query's number. */
    private fun onBackAnswer(type: String, q: Int, proxy: JavaScriptReplyProxy) {
        when (backQuery.answer(type, q)) {
            BackQuery.Outcome.IGNORE -> return
            BackQuery.Outcome.STAY -> stopBackWatchdog()
            BackQuery.Outcome.CLOSE -> {
                stopBackWatchdog()
                finish()
            }
            BackQuery.Outcome.LET_PAGE_ASK -> {
                stopBackWatchdog()
                post(proxy, JSONObject().put("t", "ask-ok").put("q", q))
            }
        }
    }

    private fun stopBackWatchdog() {
        backWatchdog?.let { main.removeCallbacks(it) }
        backWatchdog = null
    }

    /** The page was replaced or is going: no Back query stands any more. */
    private fun backAnswered() {
        stopBackWatchdog()
        backQuery.reset()
    }

    private fun askBeforeClosing() {
        if (isFinishing || isDestroyed || closeDialog != null) return
        closeDialog = AlertDialog.Builder(this)
            .setMessage(R.string.close_question)
            .setPositiveButton(R.string.close_close) { _, _ -> finish() }
            .setNegativeButton(R.string.close_cancel, null)
            .setOnDismissListener { closeDialog = null }
            .show()
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
        sidePage?.onResume()
    }

    override fun onPause() {
        sidePage?.onPause()
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        pendingSave = null
        backAnswered()
        closeDialog?.dismiss()
        closeDialog = null
        sidePage?.let { destroyWebView(it) }
        sidePage = null
        webView?.let { destroyWebView(it) }
        webView = null
        io.shutdown()
        super.onDestroy()
    }

    // ---------------------------------------------------------------- WebView

    /** The settings both WebViews share: nothing from files or other apps, no cache, no windows. */
    @SuppressLint("SetJavaScriptEnabled")
    private fun privateView(script: Boolean): WebView {
        val view = PrivateWebView(this)
        view.setBackgroundColor(ContextCompat.getColor(this, R.color.page_background))
        view.settings.apply {
            javaScriptEnabled = script
            // The first-run notice (gate.js) keeps its one flag here; the page stores nothing else.
            // The privacy page and the disclaimer run no script and store nothing.
            domStorageEnabled = script
            allowFileAccess = false
            allowContentAccess = false
            setGeolocationEnabled(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_NO_CACHE
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
        }
        applyTextZoom(view)
        // PRIV-3 in the app: the page asks every browser not to fill in or remember its fields
        // (autocomplete="off"). Android's autofill service (a password manager, or the phone
        // maker's) is kept out of the page as well, so what the person types is never offered to
        // it for saving.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            view.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
        view.webChromeClient = Chrome()
        return view
    }

    private fun createWebView() {
        val view = privateView(script = true)
        view.webViewClient = Client()

        bridgeSupported = false
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            bridgeSupported = true
            WebViewCompat.addWebMessageListener(
                view,
                BRIDGE_NAME,
                setOf(NavigationPolicy.ASSET_ORIGIN),
            ) { _, message, sourceOrigin, isMainFrame, proxy ->
                onBridgeMessage(message, sourceOrigin, isMainFrame, proxy)
            }
        }

        // Always beneath the privacy page or the disclaimer, if one is open.
        container.addView(view, 0, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        if (sidePage != null) view.visibility = View.INVISIBLE
        webView = view
        pageProxy = null
        backAnswered()
        view.loadUrl(START_URL)
        if (!bridgeSupported) toast(R.string.webview_too_old)
    }

    /**
     * The privacy page or the disclaimer in a second WebView over the letter (E3-1): the same
     * bundled files through the same asset loader, under the same policy header, with no bridge
     * and no script (neither page has any). The letter's WebView stays as it is underneath,
     * hidden from the screen and from TalkBack until this one closes.
     */
    private fun openSidePage(url: String) {
        val view = sidePage ?: privateView(script = false).also { v ->
            v.webViewClient = SideClient()
            container.addView(v, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            sidePage = v
            webView?.visibility = View.INVISIBLE
        }
        view.loadUrl(url)
        view.requestFocus()
    }

    private fun closeSidePage() {
        val view = sidePage ?: return
        sidePage = null
        destroyWebView(view)
        webView?.let {
            it.visibility = View.VISIBLE
            it.requestFocus()
        }
    }

    private fun destroyWebView(view: WebView) {
        container.removeView(view)
        view.stopLoading()
        view.destroy()
    }

    /**
     * The WebView with one change: the keyboard is asked not to learn from what is typed
     * (IME_FLAG_NO_PERSONALIZED_LEARNING, the flag a browser's private window sets), because the
     * fields hold the person's name, address and the companies they write to. Keyboards that
     * honour the flag keep none of it in their suggestions or their history.
     */
    @SuppressLint("ViewConstructor")
    private class PrivateWebView(context: Context) : WebView(context) {
        override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection? {
            val connection = super.onCreateInputConnection(outAttrs)
            // The flag exists from Android 8.0; earlier keyboards have no such setting to honour.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                outAttrs.imeOptions = outAttrs.imeOptions or EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING
            }
            return connection
        }
    }

    // onRenderProcessGone IS implemented below. The androidx.webkit lint check also fires on any
    // direct `WebViewClient()` constructor call, and in Kotlin the superclass call in this class
    // header is one, so the warning is a false positive here and only here.
    @SuppressLint("MissingOnRenderProcessGone")
    private open inner class Client : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
            val url = request.url.toString()
            if (!NavigationPolicy.isAssetRequest(url)) return WebAssetHandler.forbidden()
            return assetLoader.shouldInterceptRequest(request.url) ?: WebAssetHandler.notFound()
        }

        /** An address inside the bundled app: true when it is handled here instead of loaded. */
        open fun inApp(url: String, request: WebResourceRequest): Boolean {
            if (request.isForMainFrame && NavigationPolicy.sidePage(url) != null) {
                openSidePage(url)
                return true
            }
            return false
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            // Leaving the app needs a press. A navigation the page starts on its own (a script
            // setting location, a meta refresh) without a recent press never opens the browser
            // or another app. hasGesture() is Chromium's user activation: a source link the
            // person taps, or the mailto: link Open email app clicks for them within a moment of
            // the press, counts; only a fault in the bundled page could start anything else (its
            // policy blocks any injected script). The page itself never leaves: the WebView stays
            // on its own origin whatever is pressed.
            val userTapped = request.isForMainFrame && request.hasGesture()
            val url = request.url.toString()
            return when (NavigationPolicy.decide(url)) {
                NavigationPolicy.Decision.IN_APP -> inApp(url, request)
                NavigationPolicy.Decision.EXTERNAL -> {
                    if (userTapped) openInBrowser(request.url)
                    true
                }
                NavigationPolicy.Decision.EXTERNAL_APP -> {
                    if (userTapped) openInOtherApp(request.url, fromLetter = view === webView)
                    true
                }
                NavigationPolicy.Decision.BLOCK -> true
            }
        }

        override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
            // The page's renderer died, usually from memory pressure. Without this the whole app
            // would be killed with it. The new page starts empty, as after a reload. A file
            // waiting for the save screen is kept: its bytes are in the app, not in the page (A3-2).
            if (view != null && view === webView) {
                webView = null
                destroyWebView(view)
                createWebView()
                toast(R.string.page_crashed)
            }
            return true
        }
    }

    /**
     * The privacy page and the disclaimer: links between the two load here, "./" or index.html
     * (back to the app) closes this page, and anything else is decided as on the letter.
     */
    @SuppressLint("MissingOnRenderProcessGone")
    private inner class SideClient : Client() {
        override fun inApp(url: String, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return true
            if (NavigationPolicy.sidePage(url) != null) return false
            if (NavigationPolicy.isStartPage(url)) closeSidePage()
            return true
        }

        override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean {
            if (view != null && view === sidePage) closeSidePage()
            return true
        }
    }

    private inner class Chrome : WebChromeClient() {
        override fun onGeolocationPermissionsShowPrompt(
            origin: String?,
            callback: android.webkit.GeolocationPermissions.Callback,
        ) {
            callback.invoke(origin, false, false)
        }

        // The page asks for no device; anything asked for is refused.
        override fun onPermissionRequest(request: PermissionRequest) = request.deny()
    }

    // Any failure to start the other app (none installed, one guarded by a permission the app
    // lacks, an address too long to pass) is a short message, never a crash.
    private fun openInBrowser(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: Exception) {
            toast(R.string.no_app_for_link)
        }
    }

    /**
     * mailto: goes to an email app as a draft (ACTION_SENDTO: nothing is sent until the person
     * presses Send there), nostr: to a Nostr client, only one that accepts being opened from a
     * web link (BROWSABLE).
     */
    private fun openInOtherApp(uri: Uri, fromLetter: Boolean) {
        val mail = uri.scheme.equals("mailto", ignoreCase = true)
        val intent = if (mail) Intent(Intent.ACTION_SENDTO, uri) else Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)
        try {
            startActivity(intent)
        } catch (_: Exception) {
            toast(if (mail) R.string.no_email_app else R.string.no_app_for_link)
            // The page's line under the buttons must not say the email app opened (E3-7).
            if (mail && fromLetter) pageProxy?.let { post(it, JSONObject().put("t", "no-email-app")) }
        }
    }

    // ---------------------------------------------------------------- bridge

    private fun onBridgeMessage(message: WebMessageCompat, origin: Uri, isMainFrame: Boolean, proxy: JavaScriptReplyProxy) {
        // The listener is registered for the asset origin only; this is the second lock.
        if (!isMainFrame || !NavigationPolicy.isAssetOrigin(origin.toString())) return
        if (message.type != WebMessageCompat.TYPE_STRING) return
        // Far longer than any request the bridge sends: dropped before it is parsed (A3-6).
        val data = message.data
        if (!OutgoingRequest.messageFits(data)) return
        val msg = try {
            JSONObject(data!!)
        } catch (_: Exception) {
            return
        }
        pageProxy = proxy
        val request = OutgoingRequest.parse(
            msg.opt("t"), msg.opt("id"),
            text = msg.opt("text"), name = msg.opt("name"), mime = msg.opt("mime"),
            data = msg.opt("data"), kind = msg.opt("kind"),
        )
        if (request == null) {
            OutgoingRequest.validId(msg.opt("id"))?.let { reply(proxy, it, false) }
            return
        }
        when (request) {
            is OutgoingRequest.Copy -> reply(proxy, request.id, copyText(request.text))
            is OutgoingRequest.Share -> reply(proxy, request.id, shareText(request.text))
            is OutgoingRequest.Save -> startSave(request, proxy)
            is OutgoingRequest.Calendar -> reply(proxy, request.id, addToCalendar(request.ics))
            is OutgoingRequest.Print -> reply(proxy, request.id, print(request))
            is OutgoingRequest.Hello -> reply(proxy, request.id, true)
            is OutgoingRequest.Stay -> onBackAnswer("stay", request.id, proxy)
            is OutgoingRequest.Close -> onBackAnswer("close", request.id, proxy)
            is OutgoingRequest.Ask -> onBackAnswer("ask", request.id, proxy)
        }
    }

    /**
     * The answer to one request, to the page that sent it: ok, and for a save that did not happen
     * whether the person cancelled the save screen or another save was still waiting.
     */
    private fun reply(proxy: JavaScriptReplyProxy, id: Int, ok: Boolean, cancelled: Boolean = false, busy: Boolean = false) {
        val msg = JSONObject().put("t", "reply").put("id", id).put("ok", ok)
        if (cancelled) msg.put("cancelled", true)
        if (busy) msg.put("busy", true)
        post(proxy, msg)
    }

    /** A message to the page. A page that has gone (its renderer stopped) simply does not hear it. */
    private fun post(proxy: JavaScriptReplyProxy, msg: JSONObject) {
        val text = msg.toString()
        main.post {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return@post
            try {
                proxy.postMessage(text)
            } catch (_: Exception) {
                // The page that asked is gone.
            }
        }
    }

    /**
     * Plain text on Android's clipboard, always marked sensitive (AND-1): a letter holds the
     * person's name, address and the company they write to, so Android 13 and later hide it in
     * the clipboard preview, and keyboards keep it out of their clipboard suggestions.
     */
    private fun copyText(text: String): Boolean =
        try {
            val clipboard = getSystemService(ClipboardManager::class.java)
            if (clipboard == null) {
                false
            } else {
                val clip = ClipData.newPlainText(CLIP_LABEL, text)
                clip.description.extras = PersistableBundle().apply { putBoolean(EXTRA_IS_SENSITIVE, true) }
                clipboard.setPrimaryClip(clip)
                true
            }
        } catch (_: Exception) {
            false
        }

    /** Android's share sheet with the text alone, as navigator.share({ text }) gives it on the website. */
    private fun shareText(text: String): Boolean {
        if (isFinishing || isDestroyed) return false
        return try {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
            startActivity(Intent.createChooser(send, getString(R.string.share_chooser)))
            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Android's save screen, suggesting the page's own neutral name (SaveName). The page hears
     * the outcome once there is one (E3-4): saved once the file is written, cancelled when the
     * person leaves the save screen, or not saved; it clears or corrects its "Saved as" line to
     * match. A second save while one is waiting is refused and leaves the first alone (A3-4).
     */
    private fun startSave(request: OutgoingRequest.Save, proxy: JavaScriptReplyProxy) {
        if (isFinishing || isDestroyed) {
            reply(proxy, request.id, false)
            return
        }
        if (pendingSave != null) {
            reply(proxy, request.id, false, busy = true)
            return
        }
        pendingSave = PendingSave(request.bytes, request.id, proxy)
        try {
            if (request.mime == SaveName.CALENDAR) saveCalendar.launch(request.name) else saveText.launch(request.name)
        } catch (_: Exception) {
            pendingSave = null
            toast(R.string.file_save_failed)
            reply(proxy, request.id, false)
        }
    }

    private fun onSaveTarget(target: Uri?) {
        val waiting = pendingSave
        pendingSave = null
        if (target == null) {
            waiting?.let { reply(it.proxy, it.id, false, cancelled = true) }
            return
        }
        io.execute {
            val ok = SaveTarget.save(documentAt(target), waiting?.bytes)
            main.post {
                if (waiting == null) {
                    // Android ended the app while the save screen was open: the letter is gone with
                    // it, and the page has started again empty. Said once (E3-5, A3-10).
                    if (!crashNoticeShown) toast(R.string.page_crashed)
                    crashNoticeShown = true
                } else {
                    toast(if (ok) R.string.file_saved else R.string.file_save_failed)
                    reply(waiting.proxy, waiting.id, ok)
                }
            }
        }
    }

    /** The save screen's document, as [SaveTarget] reads and writes it. */
    private fun documentAt(uri: Uri) = object : SaveTarget.Document {
        override fun open(mode: String): OutputStream? = contentResolver.openOutputStream(uri, mode)

        // The descriptor's own size first; a provider that serves a pipe has none, so then the size
        // it reports for the document.
        override fun size(): Long? =
            try {
                contentResolver.openFileDescriptor(uri, "r")?.use { pfd -> pfd.statSize.takeIf { it >= 0 } }
            } catch (_: Exception) {
                null
            } ?: try {
                contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
                    val i = c.getColumnIndex(OpenableColumns.SIZE)
                    if (c.moveToFirst() && i >= 0 && !c.isNull(i)) c.getLong(i) else null
                }
            } catch (_: Exception) {
                null
            }

        override fun delete() {
            try {
                DocumentsContract.deleteDocument(contentResolver, uri)
            } catch (_: Exception) {
                // Some providers do not allow it; the file stays then.
            }
        }
    }

    /**
     * Android's calendar insert intent with the reminder the page made (CalendarEvent): the
     * calendar app opens a new event, filled in, and the person saves it there or not. It is a
     * timed event, 12:00 to 12:30 on the reminder day in the phone's own time zone, not an all-day
     * one, because calendar apps disagree about all-day insert intents (phone test P-1: Fossify
     * showed two days, Proton ignored the flag; Marcos, 2026-10-16). No calendar permission is
     * needed, because the app never reads or writes a calendar itself.
     */
    private fun addToCalendar(ics: ByteArray): Boolean {
        if (isFinishing || isDestroyed) return false
        val event = CalendarEvent.parse(ics)
        if (event == null) {
            toast(R.string.calendar_failed)
            return false
        }
        val zone = TimeZone.getDefault()
        val begin = event.beginMillis(zone)
        val end = event.endMillis(zone)
        if (debuggable) Log.d(TAG, "calendar insert: begin $begin end $end zone ${zone.id} allDay false")
        val intent = Intent(Intent.ACTION_INSERT)
            .setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, false)
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, begin)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end)
            .putExtra(CalendarContract.Events.TITLE, event.title)
            .putExtra(CalendarContract.Events.DESCRIPTION, event.description)
            .putExtra(CalendarContract.Events.AVAILABILITY, CalendarContract.Events.AVAILABILITY_FREE)
        return try {
            startActivity(intent)
            true
        } catch (_: ActivityNotFoundException) {
            toast(R.string.no_calendar_app)
            false
        } catch (_: Exception) {
            toast(R.string.calendar_failed)
            false
        }
    }

    /** Android's print screen, which also offers Save as PDF, with the text alone on A4. */
    private fun print(request: OutgoingRequest.Print): Boolean {
        if (isFinishing || isDestroyed) return false
        val name = getString(
            when (request.kind) {
                OutgoingRequest.PrintKind.LETTER -> R.string.print_job_letter
                OutgoingRequest.PrintKind.FOLLOW_UP -> R.string.print_job_follow_up
                OutgoingRequest.PrintKind.TIMELINE -> R.string.print_job_timeline
            },
        )
        return try {
            val manager = getSystemService(PrintManager::class.java) ?: error("no print service")
            val attrs = PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME)
                .build()
            manager.print(name, LetterPrintAdapter(this, request.text, name), attrs)
            true
        } catch (_: Exception) {
            toast(R.string.print_failed)
            false
        }
    }

    private fun toast(res: Int) {
        Toast.makeText(this, res, Toast.LENGTH_LONG).show()
    }

    companion object {
        private const val START_URL = "https://${NavigationPolicy.ASSET_HOST}/index.html"
        private const val BRIDGE_NAME = "GLBridge"
        private const val CLIP_LABEL = "GDPRLetterBuilder"
        private const val TAG = "GDPRLetterBuilder"
        // ClipDescription.EXTRA_IS_SENSITIVE (API 33), written out so older versions get the
        // same key, which some keyboards honour there too.
        private const val EXTRA_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE"

        /** How long the page has to answer Back before the app asks itself. */
        private const val BACK_ANSWER_MS = 1_500L
    }
}
