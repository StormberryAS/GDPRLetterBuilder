package no.stormberry.gdprletterbuilder

import kotlin.math.max
import kotlin.math.min

/**
 * The print layout's arithmetic: where the text and the footer go on the page, and which lines of
 * the laid-out text go on which page. Pure Kotlin, unit tested; LetterPrintAdapter does the drawing.
 *
 * The page's print style sheet (style.css, @media print, OUT-4) prints the letter alone on A4,
 * black on white, 11 pt, line height 1.45, margins 20 mm at the top and sides and 22 mm at the
 * bottom, with "Page x of y" centred in the bottom margin. The app prints the same text with the
 * same measures, so a printed letter looks the same whether it came from the website or the app;
 * only the typeface differs (Android's own sans-serif, because Android cannot load the page's
 * woff2 fonts for drawing).
 */
object PrintPages {
    /** PDF units are points, 72 to the inch. */
    const val POINTS_PER_INCH = 72f
    private const val MM_PER_INCH = 25.4f

    const val TEXT_SIZE = 11f
    const val LINE_HEIGHT = 1.45f
    const val FOOTER_SIZE = 8.5f

    val MARGIN_TOP = mm(20f)
    val MARGIN_SIDE = mm(20f)
    val MARGIN_BOTTOM = mm(22f)

    /**
     * The least room under the text for the footer, used only when a printer's own bottom margin
     * already takes the page's 22 mm: two footer lines' height, so the footer never sits on the text.
     */
    val FOOTER_ROOM = 2 * FOOTER_SIZE

    fun mm(value: Float): Float = value / MM_PER_INCH * POINTS_PER_INCH

    /** Thousandths of an inch (Android's media sizes) to points. */
    fun milsToPoints(mils: Int): Float = mils / 1000f * POINTS_PER_INCH

    /**
     * Thousandths of an inch to whole points, rounded down, as PrintedPdfDocument sizes its pages
     * and the printable area inside them.
     */
    fun milsToWholePoints(mils: Int): Int = milsToPoints(mils).toInt()

    /**
     * Where everything goes on one page, in the coordinates of the canvas PrintedPdfDocument hands
     * out: that canvas starts at the top left corner of the PRINTABLE AREA (the paper less the
     * printer's minimum margins) and is clipped to it, not at the paper's corner. So the page's
     * own margins are measured from the paper's edge and only what they exceed the printer's
     * margins by is added inside the printable area; a printer's margin is never counted twice.
     * The footer is centred on the paper, which is [footerX] from the printable area's left edge,
     * and sits in the middle of the room between the text and the printable area's bottom edge.
     */
    class Geometry(
        val pageWidth: Int,
        val pageHeight: Int,
        val printableWidth: Int,
        val printableHeight: Int,
        val minLeft: Int,
        val left: Float,
        val top: Float,
        val right: Float,
        val bottom: Float,
    ) {
        val bodyWidth: Int get() = max(1, (printableWidth - left - right).toInt())
        val bodyHeight: Int get() = max(1, (printableHeight - top - bottom).toInt())

        /** The paper's centre line, measured from the printable area's left edge. */
        val footerX: Float get() = pageWidth / 2f - minLeft

        /** The footer's baseline: centred in the room under the text, and never below the printable area. */
        val footerBaseline: Float
            get() {
                val bodyBottom = top + bodyHeight
                val centred = bodyBottom + (printableHeight - bodyBottom) / 2f + FOOTER_SIZE / 3f
                return min(centred, printableHeight - FOOTER_SIZE / 3f)
            }
    }

    /**
     * The geometry for a page of [widthMils] by [heightMils] with the printer's minimum margins
     * (all in thousandths of an inch, as Android's PrintAttributes give them).
     */
    fun geometry(widthMils: Int, heightMils: Int, minLeftMils: Int = 0, minTopMils: Int = 0, minRightMils: Int = 0, minBottomMils: Int = 0): Geometry {
        val width = milsToWholePoints(widthMils)
        val height = milsToWholePoints(heightMils)
        val minLeft = milsToWholePoints(minLeftMils)
        val minTop = milsToWholePoints(minTopMils)
        val minRight = milsToWholePoints(minRightMils)
        val minBottom = milsToWholePoints(minBottomMils)
        val printableWidth = max(1, width - minLeft - minRight)
        val printableHeight = max(1, height - minTop - minBottom)
        return Geometry(
            pageWidth = width,
            pageHeight = height,
            printableWidth = printableWidth,
            printableHeight = printableHeight,
            minLeft = minLeft,
            left = max(0f, MARGIN_SIDE - minLeft),
            top = max(0f, MARGIN_TOP - minTop),
            right = max(0f, MARGIN_SIDE - minRight),
            bottom = max(FOOTER_ROOM, MARGIN_BOTTOM - minBottom),
        )
    }

    /**
     * The first line of each page. [lineTops] and [lineBottoms] are each line's top and bottom
     * in the laid-out text, from the top of the text; [bodyHeight] is the height a page holds.
     * A page takes every line that ends within its height, counted from the top of its first
     * line; a single line taller than a page gets a page of its own. Never empty: no lines give
     * one page starting at line 0.
     */
    fun pageStarts(lineTops: IntArray, lineBottoms: IntArray, bodyHeight: Int): List<Int> {
        require(lineTops.size == lineBottoms.size) { "a top and a bottom for every line" }
        require(bodyHeight > 0) { "a page must hold something" }
        val starts = mutableListOf(0)
        var pageTop = if (lineTops.isEmpty()) 0 else lineTops[0]
        for (i in lineTops.indices) {
            if (lineBottoms[i] - pageTop > bodyHeight && i > starts.last()) {
                starts += i
                pageTop = lineTops[i]
            }
        }
        return starts
    }

    /** The footer's text, as the page's print style sheet writes it: "Page 2 of 3". */
    fun footer(page: Int, pages: Int): String = "Page $page of $pages"
}
