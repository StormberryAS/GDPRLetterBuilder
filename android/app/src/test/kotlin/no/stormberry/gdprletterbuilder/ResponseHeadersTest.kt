package no.stormberry.gdprletterbuilder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ResponseHeadersTest {
    private val csp = ResponseHeaders.ALL.getValue("Content-Security-Policy")

    private fun directive(name: String): List<String> =
        csp.split(';').map { it.trim() }.firstOrNull { it == name || it.startsWith("$name ") }?.split(' ')?.drop(1)
            ?: error("no $name directive")

    @Test fun everyResponseCarriesTheFullPolicy() {
        // The page's meta policy (spec section 9) plus the two directives only a header can carry
        // (tests/android-app.test.ts compares it with index.html as well).
        assertEquals(
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; " +
                "connect-src 'none'; form-action 'none'; object-src 'none'; base-uri 'none'; worker-src 'none'; " +
                "frame-ancestors 'none'; upgrade-insecure-requests",
            csp,
        )
    }

    @Test fun noNetworkNoEvalNoInlineNoWorker() {
        assertEquals(listOf("'self'"), directive("script-src"))
        assertFalse(csp.contains("'unsafe-eval'"))
        assertFalse(csp.contains("'wasm-unsafe-eval'"))
        assertFalse(csp.contains("'unsafe-inline'"))
        assertEquals(listOf("'none'"), directive("connect-src"))
        assertEquals(listOf("'none'"), directive("worker-src"))
        assertEquals(listOf("'none'"), directive("form-action"))
        assertEquals(listOf("'none'"), directive("frame-ancestors"))
    }

    @Test fun noReferrerOnEveryResponse() {
        assertEquals("no-referrer", ResponseHeaders.ALL["Referrer-Policy"])
    }

    @Test fun theOtherHeaders() {
        assertEquals("nosniff", ResponseHeaders.ALL["X-Content-Type-Options"])
        assertEquals("no-store", ResponseHeaders.ALL["Cache-Control"])
        assertEquals(4, ResponseHeaders.ALL.size)
    }
}
