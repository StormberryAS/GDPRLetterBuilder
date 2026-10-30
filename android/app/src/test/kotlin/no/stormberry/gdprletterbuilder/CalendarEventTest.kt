package no.stormberry.gdprletterbuilder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.TimeZone

class CalendarEventTest {
    private companion object {
        const val NOON = 12 * 60
    }

    private val golden = javaClass.getResourceAsStream("/reminder-2026-03-05.ics")!!.readBytes()

    /** The web app's own golden reminder (tests/goldens/reminder-2026-03-05.ics), copied byte for byte. */
    @Test fun thePagesReminderReadsBack() {
        val e = CalendarEvent.parse(golden)!!
        assertEquals("Follow up: Eksempel Handel AS GDPR request (deadline 7 April 2026)", e.title)
        assertTrue(e.description.startsWith("Deadline: by the end of Tuesday 7 April 2026, counted from the\n date you gave".replace("\n ", " ")))
        assertTrue(e.description.contains("\n\nWhat to do next:\n1. Check whether they have answered, or told you within the first month that they need more time."))
        assertTrue(e.description.endsWith("Made with GDPRLetterBuilder by Stormberry AS. Information, not legal advice."))
        // The day after the deadline (OUT-3): Wednesday 8 April 2026, 12.00 to 12.30 floating time
        // (changed 2026-10-16 by Marcos: noon for 30 minutes instead of all-day).
        assertEquals(CalendarEvent.daysFromCivil(2026, 4, 8), e.startDay)
        assertEquals(12 * 60, e.startMinute)
        assertEquals(12 * 60 + 30, e.endMinute)
        // Sent to the calendar app as a timed event, 12:00 to 12:30 on the phone's own clock, as
        // the file says (phone test P-1). Oslo is on summer time (UTC+2) in April.
        val oslo = TimeZone.getTimeZone("Europe/Oslo")
        assertEquals(1_775_642_400_000L, e.beginMillis(oslo)) // 2026-04-08T12:00+02:00
        assertEquals(1_775_644_200_000L, e.endMillis(oslo)) // 2026-04-08T12:30+02:00
        assertEquals(Instant.parse("2026-04-08T10:00:00Z").toEpochMilli(), e.beginMillis(oslo))
        assertEquals(Instant.parse("2026-04-08T12:00:00Z").toEpochMilli(), e.beginMillis(TimeZone.getTimeZone("UTC")))
        assertEquals(Instant.parse("2026-04-08T12:30:00Z").toEpochMilli(), e.endMillis(TimeZone.getTimeZone("UTC")))
    }

    @Test fun unfoldingWorksOnTheBytesSoAFoldInsideALetterIsHarmless() {
        val ics = ("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261113T120000\r\nDTEND:20261113T123000\r\n" +
            "SUMMARY:Follow up: Blåbær Øst AS\r\nDESCRIPTION:a\\nb\\, c\\; d \\\\ e\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n").toByteArray(Charsets.UTF_8)
        // Fold in the middle of the two bytes of a letter (RFC 5545 folds at octets).
        val at = ics.indices.first { ics[it] == 0xC3.toByte() }
        val folded = ics.copyOfRange(0, at + 1) + "\r\n ".toByteArray() + ics.copyOfRange(at + 1, ics.size)
        val e = CalendarEvent.parse(folded)!!
        assertEquals("Follow up: Blåbær Øst AS", e.title)
        assertEquals("a\nb, c; d \\ e", e.description)
        assertEquals(CalendarEvent.daysFromCivil(2026, 11, 13), e.startDay)
    }

    @Test fun onlyThePagesShapeIsAccepted() {
        val good = String(golden, Charsets.UTF_8)
        val bad = listOf(
            "",
            good.replace("BEGIN:VCALENDAR\r\n", ""),
            // The old all-day form, a time zone, UTC, a bad date or time, an end on another day or
            // not after the start, seconds, a missing or doubled start.
            good.replace("DTSTART:20260408T120000\r\nDTEND:20260408T123000", "DTSTART;VALUE=DATE:20260408\r\nDTEND;VALUE=DATE:20260409"),
            good.replace("DTSTART:20260408T120000", "DTSTART;TZID=Europe/Oslo:20260408T120000"),
            good.replace("DTSTART:20260408T120000", "DTSTART:20260408T120000Z"),
            good.replace("DTEND:20260408T123000", "DTEND:20260408T123000Z"),
            good.replace("DTSTART:20260408T120000", "DTSTART:20260230T120000"),
            good.replace("DTSTART:20260408T120000", "DTSTART:20260408T240000"),
            good.replace("DTSTART:20260408T120000", "DTSTART:20260408T126000"),
            good.replace("DTSTART:20260408T120000", "DTSTART:20260408T1200"),
            good.replace("DTSTART:20260408T120000", "DTSTART:20260408 120000"),
            good.replace("DTEND:20260408T123000", "DTEND:20260409T123000"),
            good.replace("DTEND:20260408T123000", "DTEND:20260408T120000"),
            good.replace("DTEND:20260408T123000", "DTEND:20260408T113000"),
            good.replace("DTEND:20260408T123000", "DTEND:20260408T123015"),
            good.replace("DTSTART:20260408T120000\r\n", ""),
            good.replace("DTEND:20260408T123000", "DTEND:20260408T123000\r\nDTEND:20260408T123000"),
            good.replace("SUMMARY:", "X-SUMMARY:"),
            good.replace("BEGIN:VEVENT", "BEGIN:VEVENT\r\nSUMMARY:twice"),
            good.replace("END:VCALENDAR", "BEGIN:VEVENT\r\nEND:VEVENT\r\nEND:VCALENDAR"),
            good.replace("Information\\, not", "Information\\x not"),
        )
        for (b in bad) assertNull(b.take(60), CalendarEvent.parse(b.toByteArray(Charsets.UTF_8)))
        assertNull(CalendarEvent.parse(byteArrayOf(0xFF.toByte(), 0xFE.toByte())))
        assertNull(CalendarEvent.parse(null))
    }

    @Test fun daysFromCivilMatchesTheCalendar() {
        assertEquals(0L, CalendarEvent.daysFromCivil(1970, 1, 1))
        assertEquals(-1L, CalendarEvent.daysFromCivil(1969, 12, 31))
        assertEquals(11_016L, CalendarEvent.daysFromCivil(2000, 2, 29))
        assertEquals(20_742L, CalendarEvent.daysFromCivil(2026, 10, 16))
        assertEquals(CalendarEvent.daysFromCivil(2028, 2, 29) + 1, CalendarEvent.daysFromCivil(2028, 3, 1))
        assertNull(CalendarEvent.day("20270229"))
        assertEquals(CalendarEvent.daysFromCivil(2028, 2, 29), CalendarEvent.day("20280229"))
        assertNull(CalendarEvent.day("2026-04-08"))
        // Every day from 1900 to 2299 is the day before the next one, with no gap and no repeat,
        // reads back as the same date, and its event is sent as 12:00 to 12:30 local time on that
        // very date (checked against java.time in Oslo, with its summer time, and in UTC).
        val zones = listOf("Europe/Oslo", "UTC").map { ZoneId.of(it) to TimeZone.getTimeZone(it) }
        var prev = CalendarEvent.day("19000101")!! - 1
        var days = 0
        for (y in 1900..2299) for (m in 1..12) for (d in 1..31) {
            val v = CalendarEvent.day("%04d%02d%02d".format(y, m, d)) ?: continue
            assertEquals("$y-$m-$d", prev + 1, v)
            prev = v
            assertEquals("$y-$m-$d", Triple(y, m, d), CalendarEvent.civilFromDays(v))
            assertEquals("$y-$m-$d", v to NOON, CalendarEvent.floating("%04d%02d%02dT120000".format(y, m, d)))
            val e = CalendarEvent("t", "", v, NOON, NOON + 30)
            val date = LocalDate.of(y, m, d)
            for ((id, tz) in zones) {
                val noon = date.atTime(12, 0).atZone(id).toInstant().toEpochMilli()
                assertEquals("$y-$m-$d $id", noon, e.beginMillis(tz))
                assertEquals("$y-$m-$d $id", noon + 30 * 60_000L, e.endMillis(tz))
            }
            days++
        }
        assertEquals(146_097, days) // 400 Gregorian years
    }

    /**
     * Phone test P-1 and Marcos's instruction of 2026-10-16: in the phone's own zone the event
     * starts at 12:00 on the reminder's date and lasts exactly 30 minutes, also on the days the
     * clocks change, on both sides of the date line, and in zones with half-hour offsets.
     */
    @Test fun theEventIsAtNoonLocalTimeForThirtyMinutesInEveryZone() {
        // The page's own file gives exactly this event.
        val g = CalendarEvent.parse(golden)!!
        assertEquals(CalendarEvent(g.title, g.description, CalendarEvent.daysFromCivil(2026, 4, 8), NOON, NOON + 30), g)
        val starts = listOf(
            CalendarEvent.parse(golden)!!.startDay,
            CalendarEvent.daysFromCivil(1900, 1, 1),
            CalendarEvent.daysFromCivil(1969, 12, 31),
            CalendarEvent.daysFromCivil(1970, 1, 1),
            CalendarEvent.daysFromCivil(2026, 3, 29), // summer time starts in Oslo (02:00 to 03:00)
            CalendarEvent.daysFromCivil(2026, 10, 25), // and ends (03:00 to 02:00)
            CalendarEvent.daysFromCivil(2026, 3, 8), // and in New York
            CalendarEvent.daysFromCivil(2026, 11, 1),
            CalendarEvent.daysFromCivil(2026, 4, 5), // Auckland leaves summer time
            CalendarEvent.daysFromCivil(2026, 9, 27), // and starts it
            CalendarEvent.daysFromCivil(2026, 11, 17), // the reminder of the phone test
            CalendarEvent.daysFromCivil(2028, 2, 29),
            CalendarEvent.daysFromCivil(2299, 12, 31),
        ) + (0 until 400).map { CalendarEvent.daysFromCivil(2026, 1, 1) + it }
        val ids = listOf(
            "Europe/Oslo", "UTC", "America/New_York", "Pacific/Auckland", "Pacific/Kiritimati",
            "Pacific/Pago_Pago", "Asia/Kolkata", "Australia/Lord_Howe", "America/Sao_Paulo", "Europe/Lisbon",
        )
        for (id in ids) {
            val zone = ZoneId.of(id)
            val tz = TimeZone.getTimeZone(id)
            assertEquals(id, tz.id)
            for (start in starts) {
                val e = CalendarEvent("t", "", start, NOON, NOON + 30)
                val date = LocalDate.ofEpochDay(start)
                val begin = Instant.ofEpochMilli(e.beginMillis(tz)).atZone(zone)
                val end = Instant.ofEpochMilli(e.endMillis(tz)).atZone(zone)
                assertEquals("$date $id", date.atTime(12, 0), begin.toLocalDateTime())
                assertEquals("$date $id", date.atTime(12, 30), end.toLocalDateTime())
                assertEquals("$date $id", 30 * 60_000L, e.endMillis(tz) - e.beginMillis(tz))
            }
        }
        // The days the clocks change in Oslo, written out.
        val oslo = TimeZone.getTimeZone("Europe/Oslo")
        val spring = CalendarEvent("t", "", CalendarEvent.daysFromCivil(2026, 3, 29), NOON, NOON + 30)
        assertEquals(Instant.parse("2026-03-29T10:00:00Z").toEpochMilli(), spring.beginMillis(oslo))
        val autumn = CalendarEvent("t", "", CalendarEvent.daysFromCivil(2026, 10, 25), NOON, NOON + 30)
        assertEquals(Instant.parse("2026-10-25T11:00:00Z").toEpochMilli(), autumn.beginMillis(oslo))
        assertEquals(Instant.parse("2026-10-25T11:30:00Z").toEpochMilli(), autumn.endMillis(oslo))
    }
}
