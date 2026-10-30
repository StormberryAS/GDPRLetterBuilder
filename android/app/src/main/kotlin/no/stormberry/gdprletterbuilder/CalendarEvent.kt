package no.stormberry.gdprletterbuilder

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.util.GregorianCalendar
import java.util.TimeZone

/**
 * Reads the page's deadline reminder (src/ics.js, spec section 5.6) for Android's calendar
 * insert intent, which needs no permission: the calendar app opens a new event filled in with
 * these fields, and the person saves it there or not. Pure Kotlin, unit tested.
 *
 * The page's file is one event from 12.00 to 12.30 on the day after the deadline (OUT-3, changed
 * 2026-10-16 by Marcos: noon for 30 minutes instead of all-day), in floating local time, with a
 * summary (the company's name unless the person left it out, and the deadline), a description
 * (how the deadline was counted and what to do next) and an alert when it starts. An insert
 * intent cannot carry an alert: that is the calendar app's to set, and the app's message says so.
 * Nothing else from the file is used, and the file never holds the person's name, contact
 * details or letter.
 *
 * Only the page's own shape is accepted: one VCALENDAR with exactly one VEVENT whose DTSTART
 * and DTEND are floating local times (YYYYMMDDTHHMMSS, no time zone, no Z) on the same day, the
 * end after the start, and a summary. Anything else gives null, and the app says the reminder
 * could not be opened.
 */
data class CalendarEvent(
    val title: String,
    val description: String,
    /** The event's day, as days since 1970-01-01. */
    val startDay: Long,
    /** When it starts, in minutes after midnight that day (720 for the page's 12.00). */
    val startMinute: Int,
    /** When it ends, the same day (750 for the page's 12.30). */
    val endMinute: Int,
) {
    /*
     * The insert intent sends a timed event, not an all-day one (Marcos, 2026-10-16, after phone
     * test P-1): calendar apps disagree about all-day insert intents. Fossify Calendar read the
     * exclusive end (UTC midnight of the next day) as a second day, and Proton Calendar ignored the
     * all-day flag and showed 01:00 to 01:00 in Oslo. The file's floating 12.00 is read on the
     * phone's own clock, as a calendar app reads the file itself: a wall-clock date and time in the
     * zone (GregorianCalendar; java.time would need API 26, and minSdk is 24), so a summer-time
     * change cannot move it. The end is the file's length after the begin, 30 minutes.
     */

    /** The start on the event's day in [zone] (the phone's own time zone in the app): 12:00. */
    fun beginMillis(zone: TimeZone): Long {
        val (y, m, d) = civilFromDays(startDay)
        val c = GregorianCalendar(zone)
        c.clear()
        c.set(y, m - 1, d, startMinute / 60, startMinute % 60, 0)
        return c.timeInMillis
    }

    /** The file's length after [beginMillis]: 12:30 for the page's event. */
    fun endMillis(zone: TimeZone): Long = beginMillis(zone) + (endMinute - startMinute) * MINUTE_MS

    companion object {
        private const val MINUTE_MS = 60_000L
        const val MAX_TITLE = 1_000
        const val MAX_DESCRIPTION = 10_000

        fun parse(bytes: ByteArray?): CalendarEvent? {
            if (bytes == null || bytes.isEmpty()) return null
            val text = utf8(unfold(bytes)) ?: return null
            val lines = text.split("\r\n").let { if (it.lastOrNull() == "") it.dropLast(1) else it }
            if (lines.firstOrNull() != "BEGIN:VCALENDAR" || lines.lastOrNull() != "END:VCALENDAR") return null
            if (lines.count { it == "BEGIN:VEVENT" } != 1 || lines.count { it == "END:VEVENT" } != 1) return null
            val from = lines.indexOf("BEGIN:VEVENT")
            val to = lines.indexOf("END:VEVENT")
            if (to < from) return null
            var title: String? = null
            var description: String? = null
            var start: Pair<Long, Int>? = null
            var end: Pair<Long, Int>? = null
            var depth = 0
            for (line in lines.subList(from + 1, to)) {
                if (line.startsWith("BEGIN:")) { depth++; continue }
                if (line.startsWith("END:")) { depth--; continue }
                if (depth != 0) continue // the alert's own properties
                val colon = line.indexOf(':')
                if (colon <= 0) return null
                val key = line.substring(0, colon)
                val value = line.substring(colon + 1)
                when (key) {
                    "SUMMARY" -> { if (title != null) return null; title = unescape(value) ?: return null }
                    "DESCRIPTION" -> { if (description != null) return null; description = unescape(value) ?: return null }
                    "DTSTART" -> { if (start != null) return null; start = floating(value) ?: return null }
                    "DTEND" -> { if (end != null) return null; end = floating(value) ?: return null }
                    else -> if (key.startsWith("DTSTART") || key.startsWith("DTEND")) return null
                }
            }
            val t = title?.takeIf { it.isNotBlank() && it.length <= MAX_TITLE } ?: return null
            val d = (description ?: "").takeIf { it.length <= MAX_DESCRIPTION } ?: return null
            val s = start ?: return null
            val e = end ?: return null
            if (e.first != s.first || e.second <= s.second) return null
            return CalendarEvent(t, d, s.first, s.second, e.second)
        }

        /** Takes out every line fold (CRLF followed by a space or a tab), on the bytes, before decoding. */
        fun unfold(bytes: ByteArray): ByteArray {
            val out = java.io.ByteArrayOutputStream(bytes.size)
            var i = 0
            while (i < bytes.size) {
                if (i + 2 < bytes.size && bytes[i] == CR && bytes[i + 1] == LF && (bytes[i + 2] == SP || bytes[i + 2] == TAB)) {
                    i += 3
                    continue
                }
                out.write(bytes[i].toInt())
                i++
            }
            return out.toByteArray()
        }

        private const val CR: Byte = 13
        private const val LF: Byte = 10
        private const val SP: Byte = 32
        private const val TAB: Byte = 9

        private fun utf8(bytes: ByteArray): String? =
            try {
                Charsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString()
            } catch (_: CharacterCodingException) {
                null
            }

        /** RFC 5545 TEXT: \n or \N is a line break, and \\, \; and \, stand for themselves. */
        fun unescape(value: String): String? {
            val out = StringBuilder(value.length)
            var i = 0
            while (i < value.length) {
                val c = value[i]
                if (c == '\\') {
                    if (i + 1 >= value.length) return null
                    when (value[i + 1]) {
                        'n', 'N' -> out.append('\n')
                        '\\' -> out.append('\\')
                        ';' -> out.append(';')
                        ',' -> out.append(',')
                        else -> return null
                    }
                    i += 2
                    continue
                }
                if (c < ' ' && c != '\t') return null
                out.append(c)
                i++
            }
            return out.toString()
        }

        /**
         * A floating local time, YYYYMMDDTHHMMSS with whole minutes (no time zone, no Z), as the day
         * (days since 1970-01-01) and the minute of that day; null for anything else.
         */
        fun floating(value: String): Pair<Long, Int>? {
            if (value.length != 15 || value[8] != 'T') return null
            val time = value.substring(9)
            if (time.any { it !in '0'..'9' }) return null
            val h = time.substring(0, 2).toInt()
            val min = time.substring(2, 4).toInt()
            if (h > 23 || min > 59 || time.substring(4) != "00") return null
            val day = day(value.substring(0, 8)) ?: return null
            return day to h * 60 + min
        }

        /** YYYYMMDD as days since 1970-01-01, or null when it is not a real date from 1900 to 2299. */
        fun day(value: String): Long? {
            if (value.length != 8 || value.any { it !in '0'..'9' }) return null
            val y = value.substring(0, 4).toInt()
            val m = value.substring(4, 6).toInt()
            val d = value.substring(6, 8).toInt()
            if (y < 1900 || y > 2299 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null
            return daysFromCivil(y, m, d)
        }

        private fun daysInMonth(y: Int, m: Int): Int = when (m) {
            2 -> if ((y % 4 == 0 && y % 100 != 0) || y % 400 == 0) 29 else 28
            4, 6, 9, 11 -> 30
            else -> 31
        }

        /** The year, month (1 to 12) and day of [days] since 1970-01-01 (Howard Hinnant's algorithm). */
        fun civilFromDays(days: Long): Triple<Int, Int, Int> {
            val z = days + 719_468
            val era = (if (z >= 0) z else z - 146_096) / 146_097
            val doe = z - era * 146_097
            val yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365
            val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
            val mp = (5 * doy + 2) / 153
            val d = (doy - (153 * mp + 2) / 5 + 1).toInt()
            val m = (if (mp < 10) mp + 3 else mp - 9).toInt()
            val y = (yoe + era * 400 + (if (m <= 2) 1 else 0)).toInt()
            return Triple(y, m, d)
        }

        /** Days since 1970-01-01 in the proleptic Gregorian calendar (Howard Hinnant's algorithm). */
        fun daysFromCivil(year: Int, month: Int, day: Int): Long {
            val y = (if (month <= 2) year - 1 else year).toLong()
            val era = (if (y >= 0) y else y - 399) / 400
            val yoe = y - era * 400
            val mp = (month + 9) % 12
            val doy = (153 * mp + 2) / 5 + day - 1
            val doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
            return era * 146_097 + doe - 719_468
        }
    }
}
