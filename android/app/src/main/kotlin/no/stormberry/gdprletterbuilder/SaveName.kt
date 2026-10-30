package no.stormberry.gdprletterbuilder

/**
 * The only file names the app offers Android's save screen, and the type each one gets. Pure
 * Kotlin, unit tested.
 *
 * They are the page's own neutral names (OUT-2 and FU-12: the kind and a date, never a company
 * name, because a name in a file shows up in download lists and backups):
 *   access-request-YYYY-MM-DD.txt, erasure-request-YYYY-MM-DD.txt  the first letter
 *   follow-up-YYYY-MM-DD.txt                                       a follow-up letter
 *   timeline-YYYY-MM-DD.txt                                        the cover note
 *   gdpr-deadline-YYYY-MM-DD.ics                                   the deadline reminder
 * (src/format.js letterFileName and reminderFileName, src/followups.js followUpFileName,
 * src/timeline.js timelineFileName.) Any other name is refused, so nothing the person types can
 * ever become a file name, and the save screen never suggests a path.
 */
object SaveName {
    const val TEXT = "text/plain"
    const val CALENDAR = "text/calendar"

    private const val DATE = "[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])"
    private val TEXT_NAME = Regex("^(access-request|erasure-request|follow-up|timeline)-$DATE\\.txt$")
    private val CALENDAR_NAME = Regex("^gdpr-deadline-$DATE\\.ics$")

    /** The type the save screen gets for [name], or null when the name is not one of the page's. */
    fun mimeFor(name: String?): String? = when {
        name == null -> null
        TEXT_NAME.matches(name) -> TEXT
        CALENDAR_NAME.matches(name) -> CALENDAR
        else -> null
    }
}
