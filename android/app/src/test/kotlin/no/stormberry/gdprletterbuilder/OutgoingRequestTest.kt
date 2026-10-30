package no.stormberry.gdprletterbuilder

import no.stormberry.gdprletterbuilder.OutgoingRequest.Calendar
import no.stormberry.gdprletterbuilder.OutgoingRequest.Copy
import no.stormberry.gdprletterbuilder.OutgoingRequest.Print
import no.stormberry.gdprletterbuilder.OutgoingRequest.PrintKind
import no.stormberry.gdprletterbuilder.OutgoingRequest.Save
import no.stormberry.gdprletterbuilder.OutgoingRequest.Share
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class OutgoingRequestTest {
    private val letter = "Eksempel Handel AS\nPostboks 1, 0101 Oslo\n\n7. april 2026\n\nInnsyn i personopplysninger om meg\n\nÆ ø å 😀"
    private fun b64(bytes: ByteArray) = Base64.getEncoder().encodeToString(bytes)

    @Test fun copyAndShareTakeTheTextAsItIs() {
        assertEquals(Copy(1, letter), OutgoingRequest.parse("copy", 1, text = letter))
        assertEquals(Share(2, letter), OutgoingRequest.parse("share", 2, text = letter))
        // Tabs and line breaks, carriage returns included, stay: the clipboard gets what the box shows.
        assertEquals(Copy(3, "a\r\n\tb"), OutgoingRequest.parse("copy", 3, text = "a\r\n\tb"))
    }

    @Test fun textMustBeRealText() {
        for (bad in listOf(null, "", 7, true, "a\u0000b", "\uD83D", "x\uDE00", "x".repeat(OutgoingRequest.MAX_TEXT_CHARS + 1))) {
            assertNull("$bad", OutgoingRequest.parse("copy", 1, text = bad))
            assertNull("$bad", OutgoingRequest.parse("share", 1, text = bad))
            assertNull("$bad", OutgoingRequest.parse("print", 1, text = bad, kind = "letter"))
        }
        assertEquals(OutgoingRequest.MAX_TEXT_CHARS, (OutgoingRequest.parse("copy", 1, text = "x".repeat(OutgoingRequest.MAX_TEXT_CHARS)) as Copy).text.length)
    }

    @Test fun idsArePositiveWholeNumbers() {
        assertNull(OutgoingRequest.parse("copy", 0, text = "x"))
        assertNull(OutgoingRequest.parse("copy", -1, text = "x"))
        assertNull(OutgoingRequest.parse("copy", "1", text = "x"))
        assertNull(OutgoingRequest.parse("copy", 1.5, text = "x"))
        assertNull(OutgoingRequest.parse("copy", null, text = "x"))
        assertNull(OutgoingRequest.parse("copy", 3_000_000_000L, text = "x"))
        assertEquals(Copy(7, "x"), OutgoingRequest.parse("copy", 7L, text = "x"))
    }

    @Test fun unknownTypesAreIgnored() {
        for (t in listOf("open", "settings", "secure", "camera-state", "out-begin", "COPY", null, 1)) {
            assertNull("$t", OutgoingRequest.parse(t, 1, text = "x"))
        }
    }

    @Test fun saveTakesThePagesNamesTypesAndBytes() {
        val bytes = letter.toByteArray(Charsets.UTF_8)
        val txt = OutgoingRequest.parse("save", 4, name = "access-request-2026-10-16.txt", mime = "text/plain;charset=utf-8", data = b64(bytes)) as Save
        assertEquals("text/plain", txt.mime)
        assertEquals("access-request-2026-10-16.txt", txt.name)
        assertArrayEquals(bytes, txt.bytes)
        val ics = javaClass.getResourceAsStream("/reminder-2026-03-05.ics")!!.readBytes()
        val cal = OutgoingRequest.parse("save", 5, name = "gdpr-deadline-2026-04-07.ics", mime = "text/calendar;charset=utf-8", data = b64(ics)) as Save
        assertEquals("text/calendar", cal.mime)
        assertArrayEquals(ics, cal.bytes)
        for (name in listOf("erasure-request-2026-01-31.txt", "follow-up-2026-10-16.txt", "timeline-2026-10-16.txt")) {
            assertTrue(name, OutgoingRequest.parse("save", 6, name = name, mime = "text/plain;charset=utf-8", data = "eA==") is Save)
        }
    }

    @Test fun saveRefusesOtherNamesTypesAndData() {
        val ok = "eA=="
        val cases = listOf(
            Triple("Eksempel Handel AS.txt", "text/plain;charset=utf-8", ok),
            Triple("../access-request-2026-10-16.txt", "text/plain;charset=utf-8", ok),
            Triple("access-request-2026-10-16.txt", "text/html;charset=utf-8", ok),
            Triple("access-request-2026-10-16.txt", "text/plain", ok),
            Triple("access-request-2026-10-16.txt", "text/calendar;charset=utf-8", ok),
            Triple("gdpr-deadline-2026-04-07.ics", "text/plain;charset=utf-8", ok),
            Triple("access-request-2026-10-16.txt", "text/plain;charset=utf-8", ""),
            Triple("access-request-2026-10-16.txt", "text/plain;charset=utf-8", "eA"),
            Triple("access-request-2026-10-16.txt", "text/plain;charset=utf-8", "eA==\n"),
            Triple("access-request-2026-10-16.txt", "text/plain;charset=utf-8", "e A="),
        )
        for ((name, mime, data) in cases) assertNull("$name $mime $data", OutgoingRequest.parse("save", 1, name = name, mime = mime, data = data))
        assertNull(OutgoingRequest.parse("save", 1, name = null, mime = "text/plain;charset=utf-8", data = ok))
        assertNull(OutgoingRequest.parse("save", 1, name = "follow-up-2026-10-16.txt", mime = null, data = ok))
        assertNull(OutgoingRequest.parse("save", 1, name = "follow-up-2026-10-16.txt", mime = "text/plain;charset=utf-8", data = 5))
        val big = b64(ByteArray(OutgoingRequest.MAX_FILE_BYTES + 1) { 'x'.code.toByte() })
        assertNull(OutgoingRequest.parse("save", 1, name = "follow-up-2026-10-16.txt", mime = "text/plain;charset=utf-8", data = big))
        val most = b64(ByteArray(OutgoingRequest.MAX_FILE_BYTES) { 'x'.code.toByte() })
        assertTrue(OutgoingRequest.parse("save", 1, name = "follow-up-2026-10-16.txt", mime = "text/plain;charset=utf-8", data = most) is Save)
    }

    @Test fun calendarTakesTheReminderBytes() {
        val ics = javaClass.getResourceAsStream("/reminder-2026-03-05.ics")!!.readBytes()
        val req = OutgoingRequest.parse("calendar", 8, data = b64(ics)) as Calendar
        assertArrayEquals(ics, req.ics)
        assertNull(OutgoingRequest.parse("calendar", 8, data = null))
        assertNull(OutgoingRequest.parse("calendar", 8, data = b64(ByteArray(OutgoingRequest.MAX_ICS_BYTES + 1))))
    }

    @Test fun printTakesTheTextAndOneOfThreeKinds() {
        assertEquals(Print(9, letter, PrintKind.LETTER), OutgoingRequest.parse("print", 9, text = letter, kind = "letter"))
        assertEquals(Print(9, letter, PrintKind.FOLLOW_UP), OutgoingRequest.parse("print", 9, text = letter, kind = "follow-up"))
        assertEquals(Print(9, letter, PrintKind.TIMELINE), OutgoingRequest.parse("print", 9, text = letter, kind = "timeline"))
        assertNull(OutgoingRequest.parse("print", 9, text = letter, kind = "cover"))
        assertNull(OutgoingRequest.parse("print", 9, text = letter, kind = null))
    }

    @Test fun helloCloseAndStayCarryOnlyAnId() {
        assertEquals(OutgoingRequest.Hello(1), OutgoingRequest.parse("hello", 1))
        assertEquals(OutgoingRequest.Close(2), OutgoingRequest.parse("close", 2, text = "ignored"))
        assertEquals(OutgoingRequest.Stay(3), OutgoingRequest.parse("stay", 3))
        assertEquals(OutgoingRequest.Ask(4), OutgoingRequest.parse("ask", 4))
        for (t in listOf("hello", "close", "stay", "ask")) {
            assertNull(t, OutgoingRequest.parse(t, 0))
            assertNull(t, OutgoingRequest.parse(t, "1"))
        }
        assertNull(OutgoingRequest.parse("Close", 1))
    }

    @Test fun anOversizedMessageIsNotParsedAtAll() {
        // A3-6: the largest save the app takes fits; anything over 450,000 characters is dropped first.
        val save = "{\"t\":\"save\",\"id\":1,\"name\":\"access-request-2026-10-16.txt\",\"mime\":\"text/plain;charset=utf-8\",\"data\":\"" +
            "A".repeat(4 * ((OutgoingRequest.MAX_FILE_BYTES + 2) / 3)) + "\"}"
        assertTrue(OutgoingRequest.messageFits(save))
        assertTrue(OutgoingRequest.messageFits("x".repeat(OutgoingRequest.MAX_MESSAGE_CHARS)))
        assertTrue(!OutgoingRequest.messageFits("x".repeat(OutgoingRequest.MAX_MESSAGE_CHARS + 1)))
        assertTrue(!OutgoingRequest.messageFits(null))
    }
}
