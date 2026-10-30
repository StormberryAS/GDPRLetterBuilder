package no.stormberry.gdprletterbuilder

import java.io.OutputStream

/**
 * Writes a letter (.txt) or the reminder (.ics) into the document Android's save screen
 * returned, and tidies up after a failure without ever deleting a file the app did not write.
 * Pure Kotlin over [Document], unit tested with a stand-in. CheckLink's SaveTarget (stage 4b
 * review S4 and S10), for any bytes instead of a PNG only.
 *
 *  - The save screen can return an existing file that the person chose to replace. Such a file is
 *    deleted after a failure only once the app has opened it for writing, when its old content
 *    is gone anyway. Before that only an empty document is removed: the one the save screen has
 *    just made. A document of unknown or non-zero size is left exactly as it was.
 *  - A provider that refuses "wt" (write and truncate) gets plain "w", which some providers do
 *    not truncate. The size is then checked after writing, so the end of an older, longer file
 *    can never follow the letter: a size that differs fails the save, and the file is deleted.
 */
object SaveTarget {
    interface Document {
        /** A stream that writes the document in [mode] ("wt" or "w"); null or an exception when refused. */
        fun open(mode: String): OutputStream?

        /** The document's size in bytes, or null when the provider does not say. */
        fun size(): Long?

        /** Deletes the document, best effort. */
        fun delete()
    }

    /**
     * Writes [bytes] into [doc], or only tidies up when [bytes] is null (nothing may be written).
     * True only when the document holds exactly those bytes.
     */
    fun save(doc: Document, bytes: ByteArray?): Boolean {
        if (bytes == null) {
            dropIfEmpty(doc)
            return false
        }
        var opened = false
        val ok = try {
            val truncated = try {
                doc.open("wt")
            } catch (_: Exception) {
                null
            }
            val out = truncated ?: doc.open("w") ?: error("no stream")
            opened = true
            out.use { it.write(bytes) }
            if (truncated == null) {
                val size = doc.size()
                check(size == null || size == bytes.size.toLong()) { "an older file's end is left after the text" }
            }
            true
        } catch (_: Exception) {
            false
        }
        if (!ok) {
            if (opened) doc.delete() else dropIfEmpty(doc)
        }
        return ok
    }

    /** Removes the document only when it is empty: one the save screen made and nothing filled. */
    private fun dropIfEmpty(doc: Document) {
        val size = try {
            doc.size()
        } catch (_: Exception) {
            null
        }
        if (size == 0L) doc.delete()
    }
}
