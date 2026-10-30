package no.stormberry.gdprletterbuilder

import no.stormberry.gdprletterbuilder.BackQuery.Outcome
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The Back timing race (stage 3 verification): a page that answers after the app has asked in
 * its own dialog must never open a second one.
 */
class BackQueryTest {
    @Test fun nothingTypedClosesTheApp() {
        val b = BackQuery()
        val q = b.start()
        assertTrue(q > 0 && b.isWaiting)
        assertEquals(Outcome.CLOSE, b.answer("close", q))
        assertFalse(b.isWaiting)
        assertFalse(b.timedOut(q))
    }

    @Test fun somethingTypedLetsThePageAskAndItsCloseCloses() {
        val b = BackQuery()
        val q = b.start()
        assertEquals(Outcome.LET_PAGE_ASK, b.answer("ask", q))
        // Agreed: the app no longer times this Back out, so it never asks itself as well.
        assertFalse(b.timedOut(q))
        assertFalse(b.isWaiting)
        // Cancel in the page's dialog sends nothing; Close sends close with the same number.
        assertEquals(Outcome.CLOSE, b.answer("close", q))
        // Only once.
        assertEquals(Outcome.IGNORE, b.answer("close", q))
    }

    @Test fun backClosingThePagesDialogIsAStay() {
        val b = BackQuery()
        val q1 = b.start()
        assertEquals(Outcome.LET_PAGE_ASK, b.answer("ask", q1))
        // A second Back while the page's dialog is open: the page closes it as Cancel.
        val q2 = b.start()
        assertNotEquals(q1, q2)
        assertEquals(Outcome.STAY, b.answer("stay", q2))
        // The first dialog's Close can no longer close the app: that dialog is gone.
        assertEquals(Outcome.IGNORE, b.answer("close", q1))
    }

    @Test fun aLateAnswerAfterTheAppAskedItselfIsDropped() {
        for (late in listOf("ask", "stay", "close")) {
            val b = BackQuery()
            val q = b.start()
            // 1.5 s pass with no answer: the app shows its own dialog.
            assertTrue(late, b.timedOut(q))
            // The busy page now answers: no ask-ok (so its dialog never opens), no stay, no close.
            assertEquals(late, Outcome.IGNORE, b.answer(late, q))
            // Its dialog's Close, had it been sent, is dropped too.
            assertEquals(late, Outcome.IGNORE, b.answer("close", q))
            // The watchdog cannot fire twice.
            assertFalse(late, b.timedOut(q))
        }
    }

    @Test fun anAnswerToAnOlderBackIsDropped() {
        val b = BackQuery()
        val q1 = b.start()
        assertTrue(b.timedOut(q1))
        // The person cancels the app's dialog and presses Back again.
        val q2 = b.start()
        // The page, still catching up, answers the first Back: dropped.
        assertEquals(Outcome.IGNORE, b.answer("ask", q1))
        assertTrue(b.isWaiting)
        // Its answer to the second one counts.
        assertEquals(Outcome.LET_PAGE_ASK, b.answer("ask", q2))
    }

    @Test fun aSecondBackWhileWaitingStartsNothing() {
        val b = BackQuery()
        val q = b.start()
        assertEquals(0, b.start())
        assertEquals(Outcome.STAY, b.answer("stay", q))
    }

    @Test fun unknownNumbersTypesAndAReloadedPageAreIgnored() {
        val b = BackQuery()
        assertEquals(Outcome.IGNORE, b.answer("close", 0))
        assertEquals(Outcome.IGNORE, b.answer("close", 1))
        val q = b.start()
        assertEquals(Outcome.IGNORE, b.answer("close", q + 1))
        assertEquals(Outcome.IGNORE, b.answer("hello", q))
        // Neither ends the wait: the right answer, or the app's own dialog, still comes.
        assertTrue(b.isWaiting)
        assertTrue(b.timedOut(q))
        val r = b.start()
        assertEquals(Outcome.LET_PAGE_ASK, b.answer("ask", r))
        b.reset()
        assertEquals(Outcome.IGNORE, b.answer("close", r))
        assertFalse(b.timedOut(r))
    }
}
