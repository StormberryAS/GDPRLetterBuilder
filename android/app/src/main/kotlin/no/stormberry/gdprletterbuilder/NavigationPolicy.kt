package no.stormberry.gdprletterbuilder

import java.io.ByteArrayOutputStream
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction

/**
 * Decides what happens to every navigation and request the WebView makes. Pure Kotlin on
 * java.net.URI, so it is unit tested on the JVM. Taken from CheckLink's NavigationPolicy, with
 * the Go to door left out: GDPRLetterBuilder never asks the app to open an address itself.
 *
 *  - The bundled app lives at https://appassets.androidplatform.net/ and loads in the app: the
 *    page, and over it the privacy page and the disclaimer (SIDE_PAGES).
 *  - Any other http or https address (the source links to EUR-Lex, Lovdata, Curia, the EDPB and
 *    Datatilsynet, which open in a new tab on the website, and the footer's links) opens in the
 *    user's browser; the WebView stays where it is.
 *  - mailto: and nostr: addresses go to whichever app on the device handles them, as they would
 *    from the website: mailto: is how Send using email app hands over the draft (spec section 6,
 *    read into its parts by mailDraft), and nostr: is the footer's Nostr link. This is an allowlist of two schemes, APP_SCHEMES, not a
 *    door for every scheme.
 *  - Everything else (javascript:, intent:, file:, content:, data:, blob:, market: and any
 *    address that does not parse cleanly) is refused, and so is an address with sign-in
 *    details before an @, the classic way to make one address look like another.
 */
object NavigationPolicy {
    const val ASSET_HOST = "appassets.androidplatform.net"
    const val ASSET_ORIGIN = "https://$ASSET_HOST"

    enum class Decision { IN_APP, EXTERNAL, EXTERNAL_APP, BLOCK }

    /** Schemes handed to another app on the device, with no browser involved. */
    val APP_SCHEMES = setOf("mailto", "nostr")

    fun decide(url: String?): Decision {
        val uri = parse(url) ?: return Decision.BLOCK
        val scheme = uri.scheme?.lowercase() ?: return Decision.BLOCK
        if (scheme in APP_SCHEMES) {
            // Only the plain form, mailto:x@y, mailto:?subject=... or nostr:npub1..., never
            // mailto://... tricks.
            val rest = uri.rawSchemeSpecificPart
            return if (uri.isOpaque && !rest.isNullOrBlank() && !rest.startsWith("/")) Decision.EXTERNAL_APP else Decision.BLOCK
        }
        if (scheme != "http" && scheme != "https") return Decision.BLOCK
        val host = uri.host?.lowercase()
        if (host == null) {
            // java.net.URI gives no host for a name with an underscore (a_b.example), which
            // browsers open. Such an address goes to the browser only when its whole authority
            // is a plain name and an optional port: no sign-in details, no escapes, never the
            // app's own host.
            val name = plainRegistryHost(uri.rawAuthority) ?: return Decision.BLOCK
            return if (name.trimEnd('.') == ASSET_HOST) Decision.BLOCK else Decision.EXTERNAL
        }
        if (host.isEmpty() || uri.rawUserInfo != null) return Decision.BLOCK
        if (host == ASSET_HOST) {
            return if (scheme == "https" && (uri.port == -1 || uri.port == 443)) Decision.IN_APP else Decision.BLOCK
        }
        return Decision.EXTERNAL
    }

    private val PLAIN_AUTHORITY = Regex("^([A-Za-z0-9._-]*[A-Za-z0-9][A-Za-z0-9._-]*)(:([0-9]{1,5}))?$")

    /** The host of an authority java.net.URI could not read as a server, if it is a plain name and optional port. */
    private fun plainRegistryHost(authority: String?): String? {
        val m = PLAIN_AUTHORITY.matchEntire(authority ?: return null) ?: return null
        val port = m.groupValues[3]
        if (port.isNotEmpty() && port.toInt() > 65_535) return null
        return m.groupValues[1].lowercase()
    }

    /** True only for requests the bundled asset loader should answer. */
    fun isAssetRequest(url: String?): Boolean = decide(url) == Decision.IN_APP

    /**
     * The two bundled pages that open over the letter instead of in its place (E3-1): the footer's
     * Privacy and Disclaimer links and the first-run notice's "Read the full disclaimer". They open
     * in a second WebView on top, so Back returns to the letter exactly as it was; loading them in
     * the letter's own WebView would start the letter again, empty, on the way back.
     */
    val SIDE_PAGES = setOf("/privacy.html", "/disclaimer.html")

    /** The path of a side page if [url] is one of them in the bundled app, otherwise null. */
    fun sidePage(url: String?): String? {
        if (decide(url) != Decision.IN_APP) return null
        val path = parse(url)?.rawPath ?: return null
        return path.takeIf { it in SIDE_PAGES }
    }

    /** True for the letter page itself ("./" from a side page, or index.html). */
    fun isStartPage(url: String?): Boolean {
        if (decide(url) != Decision.IN_APP) return false
        val path = parse(url)?.rawPath ?: return false
        return path == "" || path == "/" || path == "/index.html"
    }

    /** True when a message claims to come from the bundled page's origin, and nothing else. */
    fun isAssetOrigin(origin: String?): Boolean {
        val o = origin?.trimEnd('/') ?: return false
        return o == ASSET_ORIGIN || o == "$ASSET_ORIGIN:443"
    }

    /**
     * The parts of an email draft, read from a mailto: link: one To address, one Cc address, the
     * subject and the body, each null when the link has none. The body's line ends are \n.
     */
    data class MailDraft(val to: String?, val cc: String?, val subject: String?, val body: String?)

    /** The only fields a mailto: link from the page carries (src/mailto.js, RFC 6068). */
    private val MAIL_FIELDS = setOf("cc", "subject", "body")

    /** What a single address never holds: a space or line break, a separator, brackets or quotes. */
    private val NOT_IN_ADDRESS = Regex("[\\s,;:<>()\\[\\]\\\\\"\\p{Cntrl}]")

    /**
     * Send using email app (spec section 6, OUT-1): the page's mailto: link read into its parts, so
     * the app can hand each one to the email app on its own (ACTION_SENDTO with EXTRA_EMAIL,
     * EXTRA_CC, EXTRA_SUBJECT and EXTRA_TEXT). An email app then gets the whole letter even when
     * it reads only part of a long link, or ignores the fields after the "?".
     *
     * Null, so nothing is handed over, for anything the page never makes: a link refused by
     * decide(), a field other than cc, subject and body (to, bcc, in-reply-to or any header), a
     * field given twice, a broken %-escape or invalid UTF-8, an address that is not exactly one
     * address (a second one after a comma, a line break, angle brackets), and a subject with a
     * line break or other control character. The links of the privacy page and the disclaimer
     * (mailto:info@stormberry.as) read as a draft with only a recipient.
     */
    fun mailDraft(url: String?): MailDraft? {
        if (decide(url) != Decision.EXTERNAL_APP) return null
        val text = url!!.trim()
        val colon = text.indexOf(':')
        if (!text.substring(0, colon).equals("mailto", ignoreCase = true)) return null
        val rest = text.substring(colon + 1)
        if ('#' in rest) return null
        val q = rest.indexOf('?')
        val rawTo = if (q < 0) rest else rest.substring(0, q)
        val to = if (rawTo.isEmpty()) null else (decode(rawTo)?.let { address(it) } ?: return null)
        val fields = HashMap<String, String>()
        if (q >= 0) {
            for (pair in rest.substring(q + 1).split('&')) {
                val eq = pair.indexOf('=')
                if (eq <= 0) return null
                val name = pair.substring(0, eq).lowercase()
                if (name !in MAIL_FIELDS || name in fields) return null
                fields[name] = decode(pair.substring(eq + 1)) ?: return null
            }
        }
        val cc = fields["cc"]?.let { address(it) ?: return null }
        val subject = fields["subject"]
        if (subject != null && subject.any { it.isISOControl() }) return null
        val body = fields["body"]?.replace("\r\n", "\n")?.replace('\r', '\n')
        return MailDraft(to, cc, subject, body)
    }

    /** One plain address (one @, something on both sides, nothing that separates or adds a header), or null. */
    private fun address(text: String): String? {
        if (text.length > 254 || NOT_IN_ADDRESS.containsMatchIn(text)) return null
        val at = text.indexOf('@')
        if (at <= 0 || at != text.lastIndexOf('@') || at == text.length - 1) return null
        return text
    }

    /**
     * Strict %-decoding as UTF-8 (a "+" stays a "+": mailto: has no form encoding). The page encodes
     * everything with encodeURIComponent, so a character outside printable ASCII is refused too.
     */
    private fun decode(text: String): String? {
        val bytes = ByteArrayOutputStream(text.length)
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c == '%') {
                if (i + 2 >= text.length) return null
                val hi = Character.digit(text[i + 1], 16)
                val lo = Character.digit(text[i + 2], 16)
                if (hi < 0 || lo < 0) return null
                bytes.write(hi * 16 + lo)
                i += 3
            } else {
                if (c.code < 0x21 || c.code > 0x7e) return null
                bytes.write(c.code)
                i += 1
            }
        }
        return try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes.toByteArray()))
                .toString()
        } catch (_: CharacterCodingException) {
            null
        }
    }

    private fun parse(url: String?): URI? {
        if (url.isNullOrBlank()) return null
        return try {
            URI(url.trim())
        } catch (_: Exception) {
            null
        }
    }
}
