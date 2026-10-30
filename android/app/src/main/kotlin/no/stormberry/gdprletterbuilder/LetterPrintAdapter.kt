package no.stormberry.gdprletterbuilder

import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.pdf.PrintedPdfDocument
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.core.graphics.withTranslation
import java.io.FileOutputStream
import kotlin.math.max

/**
 * Prints one text (the first letter, a follow-up letter or the cover note) through Android's
 * print screen, which also offers Save as PDF. The emulator check of stage 3 (spec section 14)
 * found that window.print() does nothing inside Android's WebView, so the page's Print button
 * reaches this through the bridge instead (android-bridge.js, print).
 *
 * The text is the one the page's print style sheet would print: android-bridge.js reads it from
 * the page's own print box (#print-letter) after the page has filled it, so the choice between
 * the three is the page's own (app.js, printSource). It is drawn as plain text, black on white,
 * with the page's measures (PrintPages), and the job holds nothing but the text and the page
 * numbers. The text lives only in memory and in the document Android's print service asks for.
 */
class LetterPrintAdapter(
    private val context: Context,
    private val text: String,
    private val jobName: String,
) : PrintDocumentAdapter() {

    private var attributes: PrintAttributes? = null
    private var layout: StaticLayout? = null
    private var starts: List<Int> = emptyList()

    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes,
        cancellationSignal: CancellationSignal?,
        callback: LayoutResultCallback,
        extras: Bundle?,
    ) {
        if (cancellationSignal?.isCanceled == true) {
            callback.onLayoutCancelled()
            return
        }
        val media = newAttributes.mediaSize
        if (media == null) {
            callback.onLayoutFailed(null)
            return
        }
        try {
            val geometry = geometryOf(newAttributes)
            val built = textLayout(geometry.bodyWidth)
            val tops = IntArray(built.lineCount) { built.getLineTop(it) }
            val bottoms = IntArray(built.lineCount) { built.getLineBottom(it) }
            val pages = PrintPages.pageStarts(tops, bottoms, geometry.bodyHeight)
            val changed = newAttributes != attributes || pages != starts
            attributes = newAttributes
            layout = built
            starts = pages
            val info = PrintDocumentInfo.Builder(jobName)
                .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                .setPageCount(pages.size)
                .build()
            callback.onLayoutFinished(info, changed)
        } catch (e: Exception) {
            callback.onLayoutFailed(e.message)
        }
    }

    override fun onWrite(
        pages: Array<out PageRange>,
        destination: ParcelFileDescriptor,
        cancellationSignal: CancellationSignal?,
        callback: WriteResultCallback,
    ) {
        val attrs = attributes
        val built = layout
        if (attrs == null || built == null) {
            callback.onWriteFailed(null)
            return
        }
        val geometry = geometryOf(attrs)
        val document = PrintedPdfDocument(context, attrs)
        val written = mutableListOf<PageRange>()
        try {
            val footerPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                color = FOOTER_COLOUR
                textSize = PrintPages.FOOTER_SIZE
                typeface = Typeface.SANS_SERIF
                textAlign = Paint.Align.CENTER
            }
            for (index in starts.indices) {
                if (cancellationSignal?.isCanceled == true) {
                    callback.onWriteCancelled()
                    return
                }
                if (pages.none { (it == PageRange.ALL_PAGES) || index in it.start..it.end }) continue
                val first = starts[index]
                val end = if (index + 1 < starts.size) starts[index + 1] else built.lineCount
                val page = document.startPage(index)
                val canvas = page.canvas
                canvas.drawColor(Color.WHITE)
                if (built.lineCount > 0 && end > first) {
                    val top = built.getLineTop(first)
                    val bottom = built.getLineBottom(end - 1)
                    canvas.withTranslation(geometry.left, geometry.top - top) {
                        clipRect(0f, top.toFloat(), geometry.bodyWidth.toFloat(), bottom.toFloat())
                        built.draw(this)
                    }
                }
                canvas.drawText(PrintPages.footer(index + 1, starts.size), geometry.footerX, geometry.footerBaseline, footerPaint)
                document.finishPage(page)
                written += PageRange(index, index)
            }
            FileOutputStream(destination.fileDescriptor).use { document.writeTo(it) }
            callback.onWriteFinished(merge(written).toTypedArray())
        } catch (e: Exception) {
            callback.onWriteFailed(e.message)
        } finally {
            document.close()
        }
    }

    private fun textLayout(width: Int): StaticLayout {
        val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = PrintPages.TEXT_SIZE
            typeface = Typeface.SANS_SERIF
        }
        // CSS line-height 1.45: each line 1.45 times the font size, whatever the font's own spacing.
        val natural = paint.fontMetrics.let { it.descent - it.ascent }
        val extra = max(0f, PrintPages.TEXT_SIZE * PrintPages.LINE_HEIGHT - natural)
        return StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setLineSpacing(extra, 1f)
            .setIncludePad(false)
            .build()
    }

    /**
     * The page and the text area in points, for the paper, orientation and printer chosen
     * (PrintPages.geometry: measured inside the printable area, where PrintedPdfDocument's
     * canvas starts).
     */
    private fun geometryOf(attrs: PrintAttributes): PrintPages.Geometry {
        val media = attrs.mediaSize ?: PrintAttributes.MediaSize.ISO_A4
        val min = attrs.minMargins ?: PrintAttributes.Margins.NO_MARGINS
        return PrintPages.geometry(media.widthMils, media.heightMils, min.leftMils, min.topMils, min.rightMils, min.bottomMils)
    }

    private fun merge(ranges: List<PageRange>): List<PageRange> {
        val out = mutableListOf<PageRange>()
        for (r in ranges) {
            val last = out.lastOrNull()
            if (last != null && last.end + 1 == r.start) out[out.size - 1] = PageRange(last.start, r.end) else out += r
        }
        return out
    }

    private companion object {
        /** The page's footer colour, #444. */
        val FOOTER_COLOUR = Color.rgb(0x44, 0x44, 0x44)
    }
}
