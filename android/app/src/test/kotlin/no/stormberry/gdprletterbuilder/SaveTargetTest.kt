package no.stormberry.gdprletterbuilder

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.OutputStream

/**
 * The save screen's document after a save (CheckLink's stage 4b review S4 and S10, kept): a file
 * the person chose to replace is never deleted unless the app opened it for writing, an empty one
 * the save screen made is removed, and a write through plain "w" that leaves an older file's end
 * behind fails.
 */
class SaveTargetTest {
    /**
     * A document in a stand-in provider. [content] null: deleted. [truncates]: whether "wt" is
     * allowed; "w" overwrites from the start without truncating, as some providers do.
     */
    private class FakeDocument(
        var content: ByteArray?,
        val truncates: Boolean = true,
        val sayssize: Boolean = true,
        val failWrite: Boolean = false,
    ) : SaveTarget.Document {
        val modes = mutableListOf<String>()

        override fun open(mode: String): OutputStream? {
            modes += mode
            if (mode == "wt" && !truncates) throw IllegalArgumentException("wt refused")
            val start = if (mode == "wt") ByteArray(0) else content ?: ByteArray(0)
            if (mode == "wt") content = ByteArray(0)
            return object : ByteArrayOutputStream() {
                override fun write(b: ByteArray, off: Int, len: Int) {
                    if (failWrite) throw IOException("disk full")
                    super.write(b, off, len)
                }

                override fun close() {
                    val written = toByteArray()
                    content = if (written.size >= start.size) written else written + start.copyOfRange(written.size, start.size)
                }
            }
        }

        override fun size(): Long? = if (sayssize) content?.size?.toLong() else null

        override fun delete() {
            content = null
        }
    }

    private val letter = "Eksempel AS\r\nÆ ø å, 7. april 2026\n".repeat(10).toByteArray(Charsets.UTF_8)
    private val older = ByteArray(5000) { 1 }

    @Test fun aNewDocumentGetsTheLetterByteForByte() {
        val doc = FakeDocument(ByteArray(0))
        assertTrue(SaveTarget.save(doc, letter))
        assertArrayEquals(letter, doc.content)
        assertEquals(listOf("wt"), doc.modes)
    }

    @Test fun aFileChosenToReplaceIsKeptWhenTheLetterIsGone() {
        // The waiting letter is gone (Android ended the app while its save screen was open, and the
        // letter was held in memory only): nothing is written, and the person's own file stays.
        val doc = FakeDocument(older.copyOf())
        assertFalse(SaveTarget.save(doc, null))
        assertArrayEquals(older, doc.content)
        assertTrue(doc.modes.isEmpty())
    }

    @Test fun theEmptyDocumentTheSaveScreenMadeIsRemovedWhenTheLetterIsGone() {
        val doc = FakeDocument(ByteArray(0))
        assertFalse(SaveTarget.save(doc, null))
        assertNull(doc.content)
    }

    @Test fun aDocumentOfUnknownSizeIsLeftAlone() {
        val doc = FakeDocument(older.copyOf(), sayssize = false)
        assertFalse(SaveTarget.save(doc, null))
        assertArrayEquals(older, doc.content)
    }

    @Test fun aReplacedFileIsOverwrittenWhole() {
        val doc = FakeDocument(older.copyOf())
        assertTrue(SaveTarget.save(doc, letter))
        assertArrayEquals(letter, doc.content)
    }

    @Test fun plainWThatLeavesAnOlderFilesEndFailsAndRemovesTheMix() {
        // "wt" refused, and "w" does not truncate: the letter would be followed by the end of the
        // older, longer file. That fails, and the mixed file goes.
        val doc = FakeDocument(older.copyOf(), truncates = false)
        assertFalse(SaveTarget.save(doc, letter))
        assertNull(doc.content)
        assertEquals(listOf("wt", "w"), doc.modes)
    }

    @Test fun plainWIntoANewDocumentIsFine() {
        val doc = FakeDocument(ByteArray(0), truncates = false)
        assertTrue(SaveTarget.save(doc, letter))
        assertArrayEquals(letter, doc.content)
    }

    @Test fun aWriteThatFailsAfterOpeningRemovesTheBrokenFile() {
        val doc = FakeDocument(older.copyOf(), failWrite = true)
        assertFalse(SaveTarget.save(doc, letter))
        assertNull(doc.content)
    }

    @Test fun aProviderThatOpensNothingLeavesAFilledFileAlone() {
        val refusing = object : SaveTarget.Document {
            var deleted = false
            override fun open(mode: String): OutputStream? = null
            override fun size(): Long? = 5000
            override fun delete() {
                deleted = true
            }
        }
        assertFalse(SaveTarget.save(refusing, letter))
        assertFalse(refusing.deleted)
    }
}
