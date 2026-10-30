package no.stormberry.gdprletterbuilder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Only the page's own neutral file names reach the save screen (OUT-2, FU-12). */
class SaveNameTest {
    @Test fun thePagesNames() {
        assertEquals(SaveName.TEXT, SaveName.mimeFor("access-request-2026-10-16.txt"))
        assertEquals(SaveName.TEXT, SaveName.mimeFor("erasure-request-2028-02-29.txt"))
        assertEquals(SaveName.TEXT, SaveName.mimeFor("follow-up-2026-12-31.txt"))
        assertEquals(SaveName.TEXT, SaveName.mimeFor("timeline-2026-01-01.txt"))
        assertEquals(SaveName.CALENDAR, SaveName.mimeFor("gdpr-deadline-2026-04-07.ics"))
        assertEquals("text/plain", SaveName.TEXT)
        assertEquals("text/calendar", SaveName.CALENDAR)
    }

    @Test fun nothingElse() {
        listOf(
            null, "", "letter.txt", "Eksempel Handel AS.txt", "access-request-.txt", "access-request-2026-13-01.txt",
            "access-request-2026-10-32.txt", "access-request-2026-10-16.TXT", "access-request-2026-10-16.txt.exe",
            "../access-request-2026-10-16.txt", "dir/access-request-2026-10-16.txt", "access-request-2026-10-16.ics",
            "gdpr-deadline-2026-04-07.txt", "follow-up-2026-10-16.txt\n", " follow-up-2026-10-16.txt", "timeline-26-10-16.txt",
        ).forEach { assertNull("$it", SaveName.mimeFor(it)) }
    }
}
