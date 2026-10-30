package no.stormberry.gdprletterbuilder

import no.stormberry.gdprletterbuilder.NavigationPolicy.Decision.BLOCK
import no.stormberry.gdprletterbuilder.NavigationPolicy.Decision.EXTERNAL
import no.stormberry.gdprletterbuilder.NavigationPolicy.Decision.EXTERNAL_APP
import no.stormberry.gdprletterbuilder.NavigationPolicy.Decision.IN_APP
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NavigationPolicyTest {
    @Test fun theBundledAppLoadsInPlace() {
        assertEquals(IN_APP, NavigationPolicy.decide("https://appassets.androidplatform.net/index.html"))
        assertEquals(IN_APP, NavigationPolicy.decide("https://appassets.androidplatform.net/"))
        assertEquals(IN_APP, NavigationPolicy.decide("https://appassets.androidplatform.net/disclaimer.html#top"))
        assertEquals(IN_APP, NavigationPolicy.decide("https://APPASSETS.androidplatform.net/app.js?v=1"))
        assertEquals(IN_APP, NavigationPolicy.decide("https://appassets.androidplatform.net:443/index.html"))
    }

    /**
     * The footer's Privacy and Disclaimer, the notice's "Read the full disclaimer" and the pages'
     * "Back to GDPRLetterBuilder" (./) stay inside the app; the links out of those pages (the
     * register, Datatilsynet) open in the browser, and the email address in the mail app.
     */
    @Test fun theLegalPagesOpenInPlaceAndTheirOutsideLinksLeave() {
        assertEquals(IN_APP, NavigationPolicy.decide("https://appassets.androidplatform.net/privacy.html"))
        assertEquals(IN_APP, NavigationPolicy.decide("https://appassets.androidplatform.net/disclaimer.html"))
        assertEquals(IN_APP, NavigationPolicy.decide("https://appassets.androidplatform.net/"))
        assertEquals(EXTERNAL, NavigationPolicy.decide("https://stormberry.as/privacy"))
        assertEquals(EXTERNAL, NavigationPolicy.decide("https://www.datatilsynet.no"))
        assertEquals(EXTERNAL, NavigationPolicy.decide("https://github.com/StormberryAS"))
        assertEquals(EXTERNAL, NavigationPolicy.decide("https://virksomhet.brreg.no/nb/oppslag/enheter/937751249"))
        assertEquals(EXTERNAL_APP, NavigationPolicy.decide("mailto:info@stormberry.as"))
    }

    @Test fun theAssetHostIsOnlyTrustedOverHttpsOnItsOwnPort() {
        assertEquals(BLOCK, NavigationPolicy.decide("http://appassets.androidplatform.net/index.html"))
        assertEquals(BLOCK, NavigationPolicy.decide("https://appassets.androidplatform.net:8443/index.html"))
        assertEquals(EXTERNAL, NavigationPolicy.decide("https://appassets.androidplatform.net.evil.example/"))
        assertEquals(EXTERNAL, NavigationPolicy.decide("https://evil.example/appassets.androidplatform.net/"))
    }

    @Test fun otherWebAddressesOpenInTheBrowser() {
        assertEquals(EXTERNAL, NavigationPolicy.decide("https://stormberry.as/labs.html"))
        assertEquals(EXTERNAL, NavigationPolicy.decide("https://username.stormberry.as"))
        assertEquals(EXTERNAL, NavigationPolicy.decide("https://zapstore.dev/apps/x"))
        assertEquals(EXTERNAL, NavigationPolicy.decide("http://example.com/"))
        assertEquals(EXTERNAL, NavigationPolicy.decide("https://virksomhet.brreg.no/nb/oppslag/enheter/937751249"))
    }

    @Test fun everyOtherSchemeIsRefused() {
        listOf(
            "javascript:alert(1)",
            "JavaScript:alert(1)",
            "intent://scan/#Intent;scheme=example;package=com.example;end",
            "file:///data/data/no.stormberry.gdprletterbuilder/shared_prefs/x.xml",
            "content://media/external/images/media/1",
            "data:text/html,<script>alert(1)</script>",
            "blob:https://appassets.androidplatform.net/1234",
            "about:blank",
            "ftp://example.com/",
            "market://details?id=x",
        ).forEach { assertEquals(it, BLOCK, NavigationPolicy.decide(it)) }
    }

    @Test fun mailAndNostrLinksGoToAnotherApp() {
        assertEquals(EXTERNAL_APP, NavigationPolicy.decide("mailto:info@stormberry.as"))
        assertEquals(EXTERNAL_APP, NavigationPolicy.decide("MAILTO:info@stormberry.as?subject=Hello"))
        assertEquals(
            EXTERNAL_APP,
            NavigationPolicy.decide("nostr:npub1zz9w77p2jkn95t0st9tcuea8zdn2vknf0ctrwyd4g46w3kswdccqesr0pa"),
        )
    }

    @Test fun mailAndNostrOnlyInTheirPlainForm() {
        assertEquals(BLOCK, NavigationPolicy.decide("mailto:"))
        assertEquals(BLOCK, NavigationPolicy.decide("nostr:"))
        assertEquals(BLOCK, NavigationPolicy.decide("mailto://evil.example/x"))
        assertEquals(BLOCK, NavigationPolicy.decide("nostr:/npub1x"))
        assertEquals(BLOCK, NavigationPolicy.decide("nostr:npub 1x"))
    }

    @Test fun hostsWithAnUnderscoreOpenInTheBrowser() {
        // java.net.URI gives no host for these; browsers open them.
        assertEquals(EXTERNAL, NavigationPolicy.decide("https://a_b.example/"))
        assertEquals(EXTERNAL, NavigationPolicy.decide("https://my_shop.example.com:8443/p?id=7"))
        assertEquals(EXTERNAL, NavigationPolicy.decide("http://_dmarc.example.com/"))
        assertEquals(EXTERNAL, NavigationPolicy.decide("https://a_b.example/x"))
        // Only a plain name and port: anything else in such an authority is refused.
        assertEquals(BLOCK, NavigationPolicy.decide("https://user@a_b.example/"))
        assertEquals(BLOCK, NavigationPolicy.decide("https://a_b.example:99999/"))
        assertEquals(BLOCK, NavigationPolicy.decide("https://a_b.example:/"))
        assertEquals(BLOCK, NavigationPolicy.decide("https://a_b.example:x/"))
        assertEquals(BLOCK, NavigationPolicy.decide("https://_/"))
        assertEquals(BLOCK, NavigationPolicy.decide("https://a_b%2eexample/"))
        assertEquals(BLOCK, NavigationPolicy.decide("javascript://a_b.example/"))
        // Never the app's own host, never in place.
        assertEquals(BLOCK, NavigationPolicy.decide("https://appassets.androidplatform.net:99999/"))
        assertFalse(NavigationPolicy.isAssetRequest("https://a_b.example/app.js"))
    }

    @Test fun malformedAndDeceptiveAddressesAreRefused() {
        assertEquals(BLOCK, NavigationPolicy.decide(null))
        assertEquals(BLOCK, NavigationPolicy.decide(""))
        assertEquals(BLOCK, NavigationPolicy.decide("   "))
        assertEquals(BLOCK, NavigationPolicy.decide("https://"))
        assertEquals(BLOCK, NavigationPolicy.decide("https:///index.html"))
        assertEquals(BLOCK, NavigationPolicy.decide("https://stormberry.as@evil.example/"))
        assertEquals(BLOCK, NavigationPolicy.decide("https://appassets.androidplatform.net\\@evil.example/"))
        assertEquals(BLOCK, NavigationPolicy.decide("index.html"))
    }

    @Test fun requestsOnlyReachTheAssetLoaderFromTheAssetOrigin() {
        assertTrue(NavigationPolicy.isAssetRequest("https://appassets.androidplatform.net/src/letters.js?v=c29d1685"))
        assertFalse(NavigationPolicy.isAssetRequest("https://gdpr.stormberry.as/app.js"))
        assertFalse(NavigationPolicy.isAssetRequest("http://appassets.androidplatform.net/app.js"))
    }

    @Test fun messageOrigins() {
        assertTrue(NavigationPolicy.isAssetOrigin("https://appassets.androidplatform.net"))
        assertTrue(NavigationPolicy.isAssetOrigin("https://appassets.androidplatform.net/"))
        assertFalse(NavigationPolicy.isAssetOrigin("http://appassets.androidplatform.net"))
        assertFalse(NavigationPolicy.isAssetOrigin("https://gdpr.stormberry.as"))
        assertFalse(NavigationPolicy.isAssetOrigin("null"))
        assertFalse(NavigationPolicy.isAssetOrigin(null))
    }

    /**
     * Send using email app (spec section 6, OUT-1): the page builds the address with
     * encodeURIComponent only (src/mailto.js), with or without a recipient and a Cc. Every form it
     * makes goes to the email app.
     */
    @Test fun thePagesMailtoLinksGoToTheEmailApp() {
        val enc = { s: String -> java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20") }
        listOf(
            "mailto:privacy@example.no?subject=${enc("Request for access to my personal data (GDPR Article 15)")}&body=${enc("Dear Sir or Madam,\n\nÆ ø å (c)")}",
            "mailto:?subject=${enc("Innsyn i personopplysninger om meg (personvernforordningen artikkel 15)")}",
            "mailto:dpo%2Bgdpr@example.com?subject=x",
            "mailto:privacy@example.no?cc=me@example.com&subject=x&body=y",
        ).forEach {
            assertEquals(it, EXTERNAL_APP, NavigationPolicy.decide(it))
        }
        assertTrue(NavigationPolicy.APP_SCHEMES == setOf("mailto", "nostr"))
    }

    /** The source links of the page (they open in a new tab on the website) go to the browser. */
    @Test fun theSourceLinksGoToTheBrowser() {
        listOf(
            "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679",
            "https://lovdata.no/dokument/NL/lov/2018-06-15-38",
            "https://curia.europa.eu/juris/liste.jsf?num=C-154/21",
            "https://www.edpb.europa.eu/system/files/documents/2023-04/edpb_guidelines_202201_data_subject_rights_access_v2_en.pdf",
            "https://www.datatilsynet.no/om-datatilsynet/kontakt-oss/klage-til-datatilsynet/",
            "http://stormberryr7fz5xdopi7f265d7id27bgizc6uxeliaepzstompcfpyd.onion",
        ).forEach { assertEquals(it, EXTERNAL, NavigationPolicy.decide(it)) }
    }

    /** E3-1: the privacy page and the disclaimer open over the letter; "./" and index.html are the letter. */
    @Test fun theSidePagesAndTheStartPage() {
        val base = "https://appassets.androidplatform.net"
        assertEquals("/privacy.html", NavigationPolicy.sidePage("$base/privacy.html"))
        assertEquals("/disclaimer.html", NavigationPolicy.sidePage("$base/disclaimer.html"))
        assertEquals("/privacy.html", NavigationPolicy.sidePage("$base/privacy.html#labs"))
        for (not in listOf("$base/index.html", "$base/", "$base/style.css", "https://example.com/privacy.html",
            "http://appassets.androidplatform.net/privacy.html", "$base/sub/privacy.html", "$base/privacy.htm", null, "")) {
            assertEquals("$not", null, NavigationPolicy.sidePage(not))
        }
        assertTrue(NavigationPolicy.isStartPage("$base/"))
        assertTrue(NavigationPolicy.isStartPage("$base/index.html"))
        assertTrue(NavigationPolicy.isStartPage(base))
        for (not in listOf("$base/privacy.html", "https://example.com/", "http://appassets.androidplatform.net/", null)) {
            assertFalse("$not", NavigationPolicy.isStartPage(not))
        }
    }

    // ---- mailDraft: the page's mailto: link read into the parts the email app gets

    private val enc = { s: String -> java.net.URLEncoder.encode(s, "UTF-8").replace("+", "%20") }

    /** What src/mailto.js makes: To, Cc, the subject and the whole letter, Norwegian letters and line breaks kept. */
    @Test fun aDraftWithEveryPart() {
        val body = "Til personvernombudet\r\n\r\nJeg ber om innsyn. Blåbær, ærlig, øl.\r\nMed vennlig hilsen\r\nÅse Ørn"
        val subject = "Innsyn i personopplysninger om meg (personvernforordningen artikkel 15)"
        val url = "mailto:personvern@eksempel-handel.example?cc=ase.orn@example.no&subject=${enc(subject)}&body=${enc(body)}"
        assertEquals(EXTERNAL_APP, NavigationPolicy.decide(url))
        val d = NavigationPolicy.mailDraft(url)!!
        assertEquals("personvern@eksempel-handel.example", d.to)
        assertEquals("ase.orn@example.no", d.cc)
        assertEquals(subject, d.subject)
        assertEquals("Til personvernombudet\n\nJeg ber om innsyn. Blåbær, ærlig, øl.\nMed vennlig hilsen\nÅse Ørn", d.body)
    }

    @Test fun noCcWhenThePersonGaveNoAddress() {
        val d = NavigationPolicy.mailDraft("mailto:privacy@example.no?subject=x&body=Line%201%0D%0ALine%202")!!
        assertEquals("privacy@example.no", d.to)
        assertNull(d.cc)
        assertEquals("x", d.subject)
        assertEquals("Line 1\nLine 2", d.body)
    }

    @Test fun noRecipientWhenTheCompanyEmailIsMissing() {
        val d = NavigationPolicy.mailDraft("mailto:?cc=me@example.no&subject=s&body=b")!!
        assertNull(d.to)
        assertEquals("me@example.no", d.cc)
        assertEquals("b", d.body)
    }

    /** The encoded local part (dpo+gdpr), a domain in Unicode, and a long letter kept whole. */
    @Test fun encodedAddressesAndALongBody() {
        val long = "Æøå line\r\n".repeat(20_000)
        val d = NavigationPolicy.mailDraft("mailto:dpo%2Bgdpr@b%C3%B8ker.no?subject=x&body=${enc(long)}")!!
        assertEquals("dpo+gdpr@bøker.no", d.to)
        assertEquals("Æøå line\n".repeat(20_000), d.body)
        // A "+" is a "+" in mailto:, never a space.
        assertEquals("a+b", NavigationPolicy.mailDraft("mailto:x@y.no?subject=a+b")!!.subject)
    }

    /** The footer's links on the privacy page and the disclaimer: a recipient alone. */
    @Test fun aPlainAddress() {
        assertEquals(NavigationPolicy.MailDraft("info@stormberry.as", null, null, null), NavigationPolicy.mailDraft("mailto:info@stormberry.as"))
        assertEquals("info@stormberry.as", NavigationPolicy.mailDraft("MAILTO:info@stormberry.as?subject=Hello")!!.to)
    }

    /** Nothing the page never makes is handed over: an extra header, a second address, a line break in a header. */
    @Test fun injectedHeadersAndAddressesAreRefused() {
        listOf(
            "mailto:a@b.no?subject=s&bcc=evil@example.com",
            "mailto:a@b.no?to=evil@example.com&subject=s",
            "mailto:a@b.no?subject=s&in-reply-to=x",
            "mailto:a@b.no?subject=s&subject=t",
            "mailto:a@b.no?cc=me@c.no&cc=evil@example.com",
            "mailto:a@b.no?cc=me@c.no%2Cevil@example.com",
            "mailto:a@b.no?cc=me@c.no%0D%0ABcc:%20evil@example.com",
            "mailto:a@b.no?cc=%3Cevil@example.com%3E",
            "mailto:a@b.no?cc=",
            "mailto:a@b.no?cc=nobody",
            "mailto:a@b.no%2Cevil@example.com?subject=s",
            "mailto:a@b.no;evil@example.com",
            "mailto:a@@b.no",
            "mailto:a@b.no?subject=Hi%0D%0ABcc:%20evil@example.com",
            "mailto:a@b.no?subject=Hi%0ABcc:%20evil@example.com",
            "mailto:a@b.no?subject=s&body",
            "mailto:a@b.no?subject=s&=x",
            "mailto:a@b.no?subject=%E2%28%A1",
            "mailto:a@b.no?subject=%4",
            "mailto:a@b.no?subject=%zz",
            "mailto:a@b.no?subject=s#frag",
            "mailto:",
            "mailto://evil.example/x",
            "nostr:npub1abc",
            "https://example.com/?to=a@b.no",
            null,
        ).forEach { assertNull("$it", NavigationPolicy.mailDraft(it)) }
    }
}
