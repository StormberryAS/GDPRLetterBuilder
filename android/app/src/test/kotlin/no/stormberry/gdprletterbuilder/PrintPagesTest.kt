package no.stormberry.gdprletterbuilder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PrintPagesTest {
    private fun lines(n: Int, height: Int) = IntArray(n) { it * height } to IntArray(n) { (it + 1) * height }

    @Test fun theMeasuresAreThePrintStyleSheets() {
        // style.css, @media print: A4, margins 20 mm 20 mm 22 mm, 11 pt at line height 1.45.
        assertEquals(56.69f, PrintPages.MARGIN_TOP, 0.01f)
        assertEquals(56.69f, PrintPages.MARGIN_SIDE, 0.01f)
        assertEquals(62.36f, PrintPages.MARGIN_BOTTOM, 0.01f)
        assertEquals(11f, PrintPages.TEXT_SIZE)
        assertEquals(1.45f, PrintPages.LINE_HEIGHT)
        assertEquals(8.5f, PrintPages.FOOTER_SIZE)
        // ISO A4 is 8,268 by 11,693 thousandths of an inch: 595 by 841 points.
        assertEquals(595, PrintPages.milsToPoints(8_268).toInt())
        assertEquals(841, PrintPages.milsToPoints(11_693).toInt())
        assertEquals("Page 2 of 3", PrintPages.footer(2, 3))
    }

    @Test fun aShortLetterIsOnePage() {
        val (tops, bottoms) = lines(30, 16)
        assertEquals(listOf(0), PrintPages.pageStarts(tops, bottoms, 722))
    }

    @Test fun linesFlowOnToTheNextPageWhole() {
        // 16 units a line, 100 units a page: 6 lines a page.
        val (tops, bottoms) = lines(20, 16)
        assertEquals(listOf(0, 6, 12, 18), PrintPages.pageStarts(tops, bottoms, 100))
        // Exactly full pages.
        val (t2, b2) = lines(12, 10)
        assertEquals(listOf(0, 10), PrintPages.pageStarts(t2, b2, 100))
    }

    @Test fun aLineTallerThanAPageGetsAPageOfItsOwn() {
        val tops = intArrayOf(0, 10, 160, 170)
        val bottoms = intArrayOf(10, 160, 170, 180)
        assertEquals(listOf(0, 1, 2), PrintPages.pageStarts(tops, bottoms, 100))
    }

    @Test fun noLinesIsOneEmptyPage() {
        assertEquals(listOf(0), PrintPages.pageStarts(IntArray(0), IntArray(0), 100))
    }

    // A3-1 (stage 3 review): PrintedPdfDocument's canvas starts at the printable area, the paper
    // less the printer's minimum margins, so the page's 20 mm and 22 mm are measured from the
    // paper's edge and a printer's margin is never counted twice. ISO A4 throughout.
    private val a4w = 8_268
    private val a4h = 11_693
    private val mm5 = 197 // 5 mm in thousandths of an inch, as a printer reports it
    private val mm127 = 500 // 12.7 mm, half an inch

    /** The text block and the footer, measured on the paper, for one geometry. */
    private fun onPaper(g: PrintPages.Geometry, minLeft: Int, minTop: Int): List<Float> {
        val l = PrintPages.milsToWholePoints(minLeft)
        val t = PrintPages.milsToWholePoints(minTop)
        return listOf(l + g.left, t + g.top, l + g.left + g.bodyWidth, t + g.top + g.bodyHeight, l + g.footerX, t + g.footerBaseline)
    }

    /** Everything drawn stays inside the printable area, and the footer sits under the text. */
    private fun assertInside(g: PrintPages.Geometry) {
        assertTrue("text starts inside", g.left >= 0f && g.top >= 0f)
        assertTrue("text ends inside: ${g.left + g.bodyWidth} of ${g.printableWidth}", g.left + g.bodyWidth <= g.printableWidth)
        assertTrue("text ends above the bottom", g.top + g.bodyHeight <= g.printableHeight)
        val bodyBottom = g.top + g.bodyHeight
        assertTrue("footer below the text: ${g.footerBaseline} vs $bodyBottom", g.footerBaseline - PrintPages.FOOTER_SIZE > bodyBottom)
        assertTrue("footer above the printable edge: ${g.footerBaseline} of ${g.printableHeight}", g.footerBaseline + PrintPages.FOOTER_SIZE / 3f <= g.printableHeight)
        assertTrue("footer centred on the page", g.footerX > 0f && g.footerX < g.printableWidth)
    }

    @Test fun noPrinterMarginGivesThePrintStyleSheetsMargins() {
        val g = PrintPages.geometry(a4w, a4h)
        assertEquals(595, g.printableWidth)
        assertEquals(841, g.printableHeight)
        assertEquals(PrintPages.MARGIN_SIDE, g.left, 0.001f)
        assertEquals(PrintPages.MARGIN_TOP, g.top, 0.001f)
        assertEquals(PrintPages.MARGIN_BOTTOM, g.bottom, 0.001f)
        assertEquals(481, g.bodyWidth)
        assertEquals(721, g.bodyHeight)
        assertEquals(297.5f, g.footerX, 0.001f)
        // Centred in the 22 mm bottom margin, as the page's footer is.
        assertEquals(841 - PrintPages.MARGIN_BOTTOM / 2 + PrintPages.FOOTER_SIZE / 3, g.footerBaseline, 1f)
        assertInside(g)
    }

    @Test fun aFiveMillimetrePrinterMarginIsNotCountedTwice() {
        val g = PrintPages.geometry(a4w, a4h, mm5, mm5, mm5, mm5)
        assertEquals(595 - 28, g.printableWidth)
        assertEquals(841 - 28, g.printableHeight)
        val paper = onPaper(g, mm5, mm5)
        // On the paper the text still starts 20 mm from the left and top and ends 20 mm from the right.
        assertEquals(PrintPages.MARGIN_SIDE, paper[0], 0.001f)
        assertEquals(PrintPages.MARGIN_TOP, paper[1], 0.001f)
        assertEquals(481, g.bodyWidth)
        assertEquals(721, g.bodyHeight)
        // The footer on the paper's centre line, in the bottom margin.
        assertEquals(297.5f, paper[4], 0.001f)
        assertTrue(paper[5] > 841 - PrintPages.MARGIN_BOTTOM && paper[5] < 841 - 14)
        assertInside(g)
    }

    @Test fun aHalfInchPrinterMarginKeepsTheTextAndTheFooterOnThePage() {
        val g = PrintPages.geometry(a4w, a4h, mm127, mm127, mm127, mm127)
        assertEquals(595 - 72, g.printableWidth)
        assertEquals(841 - 72, g.printableHeight)
        val paper = onPaper(g, mm127, mm127)
        assertEquals(PrintPages.MARGIN_SIDE, paper[0], 0.001f)
        assertEquals(PrintPages.MARGIN_TOP, paper[1], 0.001f)
        assertEquals(481, g.bodyWidth)
        // 22 mm less the printer's 12.7 mm is left under the text, and the footer fits in it.
        assertEquals(PrintPages.MARGIN_BOTTOM - 36, g.bottom, 0.001f)
        assertEquals(297.5f, paper[4], 0.001f)
        assertInside(g)
        // The old layout, which added the 20 mm inside the printable area, lost 36 points of text width.
        assertTrue(g.bodyWidth > (523 - 2 * PrintPages.MARGIN_SIDE).toInt())
    }

    @Test fun aPrinterMarginLargerThanThePagesKeepsRoomForTheFooter() {
        // 30 mm at the bottom and uneven sides: the text keeps 20 mm on the paper where it can,
        // starts at the printable edge where it cannot, and the footer still sits under it.
        val g = PrintPages.geometry(a4w, a4h, mm5, 0, 1_181, 1_181)
        assertEquals(PrintPages.FOOTER_ROOM, g.bottom, 0.001f)
        assertEquals(0f, g.right, 0.001f)
        val paper = onPaper(g, mm5, 0)
        assertEquals(PrintPages.MARGIN_SIDE, paper[0], 0.001f)
        assertEquals(297.5f, paper[4], 0.001f)
        assertInside(g)
        // Landscape A4 with a printer margin.
        assertInside(PrintPages.geometry(a4h, a4w, mm127, mm127, mm127, mm127))
    }
}
