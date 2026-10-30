package no.stormberry.gdprletterbuilder

/**
 * Who answers Android's Back on the letter page, so that only one "Close the app?" dialog can
 * ever be shown (stage 3 verification, the Back timing race). Pure Kotlin, unit tested;
 * MainActivity keeps one of these and android-bridge.js keeps the other end.
 *
 * Each Back on the letter is a query with its own number, sent to the page as { t: 'back', q }.
 * The page answers with that number:
 *   stay   it closed one of its own dialogs (as Cancel); nothing more happens
 *   close  nothing is typed: the app closes
 *   ask    something is typed: the page wants to open its own dialog, and opens it only when the
 *          app agrees with { t: 'ask-ok', q }
 * If no answer comes in time, the app asks in its own dialog and the query is over: a late
 * stay, close or ask with that number is dropped, and a late ask gets no ask-ok, so the page's
 * dialog cannot open on top of the app's. Once the app has agreed to an ask, the query belongs
 * to the page: the app no longer times it out, and the page's Close (sent with the same number)
 * closes the app.
 */
class BackQuery {
    /** What the app does with a message about Back. */
    enum class Outcome {
        /** Not for the current query (stale, unknown or late): nothing happens. */
        IGNORE,
        /** The page dealt with Back: stop waiting. */
        STAY,
        /** Close the app. */
        CLOSE,
        /** Let the page open its own dialog: send ask-ok. */
        LET_PAGE_ASK,
    }

    private var last = 0

    /** The query waiting for the page's first answer, or 0. */
    var waiting = 0
        private set

    /** The query whose dialog the page was allowed to open, or 0. */
    private var granted = 0

    /** True while a Back is waiting for the page's answer (a second Back is then ignored). */
    val isWaiting: Boolean get() = waiting != 0

    /**
     * Starts a query for a Back press and returns its number, or 0 when one is already waiting.
     * A dialog the page was allowed to open earlier is closed by the page itself on this Back.
     */
    fun start(): Int {
        if (waiting != 0) return 0
        last = if (last == Int.MAX_VALUE) 1 else last + 1
        waiting = last
        granted = 0
        return last
    }

    /**
     * The page has not answered query [q] in time: true when the app should now ask in its own
     * dialog. From then on nothing the page says about [q] counts.
     */
    fun timedOut(q: Int): Boolean {
        if (q == 0 || q != waiting) return false
        waiting = 0
        granted = 0
        return true
    }

    /** The page's answer [type] ("stay", "close" or "ask") to query [q]. */
    fun answer(type: String, q: Int): Outcome {
        if (q == 0 || type !in ANSWERS) return Outcome.IGNORE
        if (q == waiting) {
            waiting = 0
            return when (type) {
                "stay" -> Outcome.STAY
                "close" -> Outcome.CLOSE
                else -> {
                    granted = q
                    Outcome.LET_PAGE_ASK
                }
            }
        }
        // The person chose Close in the page's own dialog, which the app allowed for this query.
        if (q == granted && type == "close") {
            granted = 0
            return Outcome.CLOSE
        }
        return Outcome.IGNORE
    }

    private companion object {
        val ANSWERS = setOf("stay", "close", "ask")
    }

    /** The page was reloaded or replaced: whatever it was asked no longer stands. */
    fun reset() {
        waiting = 0
        granted = 0
    }
}
