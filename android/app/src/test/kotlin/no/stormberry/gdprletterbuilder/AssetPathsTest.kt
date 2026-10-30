package no.stormberry.gdprletterbuilder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AssetPathsTest {
    @Test fun plainPathsMapIntoTheWebFolder() {
        assertEquals("web/index.html", AssetPaths.resolve(""))
        assertEquals("web/index.html", AssetPaths.resolve("index.html"))
        assertEquals("web/src/letters.js", AssetPaths.resolve("src/letters.js"))
        assertEquals("web/switcher-icons/gdpr.svg", AssetPaths.resolve("switcher-icons/gdpr.svg"))
        assertEquals("web/licences/Inter-OFL-1.1.txt", AssetPaths.resolve("licences/Inter-OFL-1.1.txt"))
        assertEquals("web/fonts/inter/InterVariable.woff2", AssetPaths.resolve("fonts/inter/InterVariable.woff2"))
        assertEquals("web/fonts/inter/index.html", AssetPaths.resolve("fonts/inter/"))
    }

    @Test fun nothingClimbsOutOrReachesHiddenFiles() {
        assertNull(AssetPaths.resolve("../AndroidManifest.xml"))
        assertNull(AssetPaths.resolve("src/../../x.js"))
        assertNull(AssetPaths.resolve("./index.html"))
        assertNull(AssetPaths.resolve("/index.html"))
        assertNull(AssetPaths.resolve("src//letters.js"))
        assertNull(AssetPaths.resolve("a\\b.js"))
        assertNull(AssetPaths.resolve(".git/config.txt"))
        assertNull(AssetPaths.resolve("src/.hidden.js"))
        assertNull(AssetPaths.resolve("app.js\u0000.txt"))
        assertNull(AssetPaths.resolve(null))
    }

    @Test fun onlyTheTypesThePageUsesAreServed() {
        assertNull(AssetPaths.resolve("dexopt/baseline.prof"))
        assertNull(AssetPaths.resolve("README"))
        assertNull(AssetPaths.resolve("og-image.webp"))
        assertNull(AssetPaths.resolve("DISCLAIMER.md"))
        assertNull(AssetPaths.resolve("x.json"))
        assertNull(AssetPaths.resolve("x.wasm"))
        assertNull(AssetPaths.resolve("x.mjs"))
        assertNull(AssetPaths.resolve("tools/x.py"))
    }

    @Test fun contentTypes() {
        assertEquals("text/javascript", AssetPaths.mimeType("web/app.js"))
        assertEquals("text/javascript", AssetPaths.mimeType("web/src/deadline.js"))
        assertEquals("text/html", AssetPaths.mimeType("web/index.html"))
        assertEquals("text/css", AssetPaths.mimeType("web/style.css"))
        assertEquals("image/svg+xml", AssetPaths.mimeType("web/favicon.svg"))
        assertEquals("font/woff2", AssetPaths.mimeType("web/fonts/inter/InterVariable.woff2"))
        assertEquals("text/plain", AssetPaths.mimeType("web/licences/Inter-OFL-1.1.txt"))
        assertEquals("web/apple-touch-icon.png", AssetPaths.resolve("apple-touch-icon.png"))
        assertEquals("image/png", AssetPaths.mimeType("web/apple-touch-icon.png"))
        assertNull(AssetPaths.encoding("web/apple-touch-icon.png"))
        assertEquals("utf-8", AssetPaths.encoding("web/app.js"))
        assertEquals("utf-8", AssetPaths.encoding("web/favicon.svg"))
        assertNull(AssetPaths.encoding("web/fonts/inter/Inter-Regular.woff2"))
    }

    /**
     * The privacy page, the disclaimer with its style sheet and the first-run notice are bundled
     * (WebAssets.INCLUDES) and served from the APK like the page itself, so the footer's links work
     * offline.
     */
    @Test fun theLegalPagesAndTheNoticeAreServedFromTheApk() {
        for (name in listOf("privacy.html", "disclaimer.html", "disclaimer.css", "gate.js", "gate.css")) {
            val path = AssetPaths.resolve(name)
            assertEquals("web/$name", path)
            assertEquals("utf-8", AssetPaths.encoding(path!!))
        }
        assertEquals("text/html", AssetPaths.mimeType("web/privacy.html"))
        assertEquals("text/css", AssetPaths.mimeType("web/disclaimer.css"))
        assertEquals("text/javascript", AssetPaths.mimeType("web/gate.js"))
    }

    /** The build bundles exactly these types (WebAssets.ALLOWED_EXTENSIONS in app/build.gradle.kts). */
    @Test fun everyTypeTheBuildMayBundleIsServedAndNoOther() {
        assertEquals(setOf("html", "js", "css", "svg", "png", "woff2", "txt"), AssetPaths.extensions)
    }
}
