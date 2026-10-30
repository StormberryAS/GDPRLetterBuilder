package no.stormberry.gdprletterbuilder

import kotlin.io.encoding.Base64

/**
 * Checks every request the page sends the app over the GLBridge channel before the app acts on
 * it. Pure Kotlin, unit tested. Adapted from CheckLink's OutgoingRequest.
 *
 * The page is the app's own bundled code, but what it hands over is whatever the person typed
 * or pasted into an editable letter box, so every field is checked for type, size and shape, and
 * anything unexpected is refused whole. The message fields arrive as whatever org.json found
 * (String, Boolean, Integer, JSONObject.NULL...); MainActivity passes them in untouched, and
 * only the exact types named here are accepted.
 *
 * The requests (android-bridge.js builds them; the full contract is in that file):
 *   copy      { id, text }              plain text on Android's clipboard, always marked sensitive
 *   share     { id, text }              Android's share sheet with the text, the app left out
 *   save      { id, name, mime, data }  Android's save screen for a .txt or .ics file; the name
 *                                       must be one of the page's neutral names ([SaveName])
 *   calendar  { id, data }              the reminder's .ics, for a calendar insert intent
 *                                       ([CalendarEvent] reads it)
 *   print     { id, text, kind }        Android's print screen with the text alone ([PrintKind])
 *   hello     { id }                    sent once as the page starts, so the app can reach the page
 *                                       (Back, a missing email app) before any other request
 *   close     { id }                    Back: nothing is typed, or the person chose Close in the
 *                                       page's own dialog; the app closes
 *   stay      { id }                    Back: the page closed one of its own dialogs
 *   ask       { id }                    Back: something is typed, and the page would open its own
 *                                       "Close the app?" dialog once the app agrees
 * For close, stay and ask the id is the number of the app's Back query ([BackQuery]), not one of
 * the page's own request numbers, so an answer to an older Back can be told apart and dropped.
 */
object OutgoingRequest {
    /**
     * Far above any letter the page writes (a few thousand characters), and short enough for
     * Android's clipboard, share sheet and print service, which pass the text between apps.
     */
    const val MAX_TEXT_CHARS = 100_000

    /** The largest file the save screen is given: the longest text above, all in 3-byte UTF-8. */
    const val MAX_FILE_BYTES = 3 * MAX_TEXT_CHARS

    /** The page's reminder is about 2 kB; anything far beyond that is not the page's file. */
    const val MAX_ICS_BYTES = 64 * 1024

    /**
     * The longest message, in characters, that is parsed at all (A3-6): a save of [MAX_FILE_BYTES]
     * is 400,000 characters of base64 plus a short name, and android-bridge.js checks every
     * message against this same limit before it posts it, so the page tells the person instead.
     * Anything longer is dropped before org.json reads it, so an oversized message never costs
     * more than its length check.
     */
    const val MAX_MESSAGE_CHARS = 450_000

    /** True when a message is short enough to be parsed (and not absent). */
    fun messageFits(data: String?): Boolean = data != null && data.length <= MAX_MESSAGE_CHARS

    /** Which box the page is printing: the first letter, a follow-up letter or the cover note. */
    enum class PrintKind(val wire: String) { LETTER("letter"), FOLLOW_UP("follow-up"), TIMELINE("timeline") }

    sealed interface Request { val id: Int }
    data class Copy(override val id: Int, val text: String) : Request
    data class Share(override val id: Int, val text: String) : Request
    class Save(override val id: Int, val name: String, val mime: String, val bytes: ByteArray) : Request
    class Calendar(override val id: Int, val ics: ByteArray) : Request
    data class Print(override val id: Int, val text: String, val kind: PrintKind) : Request
    data class Hello(override val id: Int) : Request
    data class Close(override val id: Int) : Request
    data class Stay(override val id: Int) : Request
    data class Ask(override val id: Int) : Request

    /**
     * Returns the checked request, or null when the message must be ignored. [t] is the
     * message type; the other arguments are the raw field values, null when absent.
     */
    fun parse(
        t: Any?,
        id: Any?,
        text: Any? = null,
        name: Any? = null,
        mime: Any? = null,
        data: Any? = null,
        kind: Any? = null,
    ): Request? {
        val n = validId(id) ?: return null
        return when (t) {
            "copy" -> Copy(n, validText(text) ?: return null)
            "share" -> Share(n, validText(text) ?: return null)
            "save" -> {
                if (name !is String || mime !is String) return null
                val type = SaveName.mimeFor(name) ?: return null
                // The page's Blob type, as app.js writes it; the save screen gets the bare type.
                if (mime != "$type;charset=utf-8") return null
                val bytes = decode(data, MAX_FILE_BYTES) ?: return null
                Save(n, name, type, bytes)
            }
            "calendar" -> Calendar(n, decode(data, MAX_ICS_BYTES) ?: return null)
            "print" -> {
                val k = PrintKind.entries.firstOrNull { it.wire == kind } ?: return null
                Print(n, validText(text) ?: return null, k)
            }
            "hello" -> Hello(n)
            "close" -> Close(n)
            "stay" -> Stay(n)
            "ask" -> Ask(n)
            else -> null
        }
    }

    /**
     * Standard, padded base64 of 1 to [max] bytes, with no space, line break or other character.
     * The bytes are the Blob's own, so a saved file is byte for byte what the website saves.
     */
    fun decode(data: Any?, max: Int): ByteArray? {
        if (data !is String || data.isEmpty() || data.length > 4 * ((max + 2) / 3)) return null
        if (data.length % 4 != 0) return null
        val bytes = try {
            Base64.Default.decode(data)
        } catch (_: IllegalArgumentException) {
            return null
        }
        return bytes.takeIf { it.isNotEmpty() && it.size <= max }
    }

    /** A positive whole number that fits an Int, as the bridge counts its requests. */
    fun validId(id: Any?): Int? = when (id) {
        is Int -> id.takeIf { it > 0 }
        is Long -> id.takeIf { it in 1..Int.MAX_VALUE.toLong() }?.toInt()
        else -> null
    }

    /**
     * Text to copy, share or print: a String of 1 to MAX_TEXT_CHARS characters, with no NUL and
     * no broken surrogate pair. Line breaks, tabs and any other character stay as they are, so
     * what lands on the clipboard is exactly what the letter box shows, as on the website.
     */
    fun validText(text: Any?): String? {
        if (text !is String) return null
        if (text.isEmpty() || text.length > MAX_TEXT_CHARS) return null
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (c == '\u0000') return null
            if (Character.isHighSurrogate(c)) {
                if (i + 1 >= text.length || !Character.isLowSurrogate(text[i + 1])) return null
                i += 2
                continue
            }
            if (Character.isLowSurrogate(c)) return null
            i++
        }
        return text
    }
}
