package no.stormberry.gdprletterbuilder

/**
 * The headers on every response the asset loader gives the WebView: pages, scripts, style
 * sheets, fonts, the licence text, and the empty 403 and 404 answers. Pure Kotlin, unit tested.
 *
 * WebViewAssetLoader sends no headers of its own. The page carries its own meta policy (spec
 * section 9), and the privacy page the same one; the disclaimer page carries none, and a meta
 * tag cannot carry frame-ancestors at all. So every response carries the full policy: the
 * page's meta policy, directive for directive, plus frame-ancestors 'none' and
 * upgrade-insecure-requests, the two directives only a header can carry, as CheckLink's app
 * sends them. The browser enforces the header and the meta tag together, so the page's own
 * policy stays exactly as strict as it is on the website (connect-src 'none', no worker, no
 * WebAssembly). tests/android-app.test.ts checks that this string is the page's meta policy
 * plus those two directives and nothing else.
 *
 * upgrade-insecure-requests changes nothing in the app: every file comes from
 * https://appassets.androidplatform.net, the loader refuses plain http (setHttpAllowed(false)),
 * and the directive never touches navigations to other sites. It is kept so that the header is
 * CheckLink's recipe, unchanged.
 *
 * Referrer-Policy: no-referrer on every response (spec section 14, stage 3), as the page's own
 * meta tag says. A link that leaves the app goes to the browser through an intent, which carries
 * no referrer in any case.
 */
object ResponseHeaders {
    const val CONTENT_SECURITY_POLICY =
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
            "connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; worker-src 'none'; " +
            "frame-ancestors 'none'; upgrade-insecure-requests"

    /** The same map for every response, success or refusal. */
    val ALL: Map<String, String> = mapOf(
        "Content-Security-Policy" to CONTENT_SECURITY_POLICY,
        "X-Content-Type-Options" to "nosniff",
        "Cache-Control" to "no-store",
        "Referrer-Policy" to "no-referrer",
    )
}
