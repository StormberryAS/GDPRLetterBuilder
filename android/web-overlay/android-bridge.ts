/*! android-bridge.js is compiled from android-bridge.ts beside it by tools/build-ts.sh, which leaves
    out every comment but this one: the explanations are in the source. Edit the .ts, never the .js:
    the build refuses to overwrite a hand edit, and its check mode fails on one. */

/* GDPRLetterBuilder for Android: the bridge between the page and the app.
 *
 * This file exists ONLY inside the APK. The build copies the web app byte for byte and adds
 * one line to index.html that loads this script before gate.js and app.js; nothing else in the
 * page is changed. On the website this file is never loaded, and the page behaves exactly as it
 * always has.
 *
 * The page knows nothing of the app: it uses the browser's own ways out (the clipboard,
 * navigator.share, window.print, a Save link to a Blob, a mailto: link, links that open a new
 * tab). Inside Android's WebView some of those do nothing, so this script gives each one the
 * app's way, under the same name, before app.js starts:
 *
 *  0. WEBSITE-ONLY PARTS. Every element marked data-web-only (the "Get the Android app on
 *     Zapstore" section) is hidden: the ones in the page once it has been parsed, and the ones
 *     the page adds later as soon as they are added.
 *
 *  1. COPY. navigator.clipboard.writeText(text) puts the text on Android's clipboard through
 *     the app, always marked sensitive (AND-1: Android 13 and later hide it in the clipboard
 *     preview). It resolves once the app has done it, and rejects otherwise, so the page's own
 *     fallback (the text selected, and its message) still applies.
 *
 *  2. SHARE. navigator.share({ text }) opens Android's share sheet through the app. The page
 *     shows its Share buttons only where navigator.share exists, as on a phone's browser.
 *
 *  3. SAVE. A WebView cannot follow a Save link to a blob: address, so a click on the page's
 *     Save link (the first letter, a follow-up, the cover note, the reminder) is caught here,
 *     as in MetadataScrubber. The Blob's own bytes are read in the page (Blob.arrayBuffer) and
 *     handed to the app with the page's file name and type, and the app opens Android's save
 *     screen. The app accepts only the page's own neutral file names (SaveName.kt).
 *
 *  4. PRINT. window.print() does nothing inside Android's WebView (the emulator check of stage
 *     3). Here it fires the page's beforeprint, so the page fills its print box (#print-letter)
 *     with the letter it means to print, as in a browser; hands that text to the app, which
 *     opens Android's print screen with it (LetterPrintAdapter.kt; Save as PDF is there too);
 *     then fires afterprint, so the page goes back to its default, as in a browser. The line under
 *     the buttons, which on the website points to the browser's print window, says instead "On
 *     the Android print screen, choose Save as PDF as the printer.", and is emptied again if the
 *     print screen could not open (the app's own short message says so).
 *
 *  5. ADD TO CALENDAR APP. Beside each Save a reminder button the app adds a button of its own
 *     (the website has none). A press clicks the page's own Save a reminder button with a mark
 *     set, so the page builds the very same reminder file, with its own checks and messages; the
 *     Save link it then clicks is caught here and handed to the app as a calendar request
 *     instead of a save. The app opens the calendar app's new-event screen, filled in from the
 *     file (CalendarEvent.kt), and the status line under the buttons says what happened.
 *
 *  6. BACK. Android's Back reaches the page as a message (E3-1). An open dialog is closed as
 *     Cancel would close it. Otherwise, when anything is typed (a field holds text, or a letter
 *     box has been edited), the page's own confirmation dialog asks "Close the app? What you have
 *     typed will be lost.", and only Close closes the app; with nothing typed the app closes at
 *     once. The privacy page and the disclaimer open over the letter in the app, so Back from
 *     them never reaches the page. Each Back carries the app's query number q, and every answer
 *     to it carries the same number. The page opens its dialog only after the app agrees
 *     (ask, then ask-ok): if the page was too busy to answer in time, the app has already asked
 *     in its own dialog and never agrees, so two dialogs can never be shown (BackQuery.kt).
 *
 *  7. WHAT THE STATUS LINES SAY. The line under the buttons follows what the app did:
 *     - a Save the person cancels on Android's save screen clears the page's "Saved as ..."
 *       line, and one that fails says "The file could not be saved. Try Save again." (E3-4);
 *     - a text too long for the app to hand over is refused before anything happens, with "This
 *       is too long for the app to hand over. Shorten it and try again." (A3-5, E3-6);
 *     - when no email app opened, the page's "Your email app should open a draft. ..." line is
 *       emptied (E3-7), and the app's own short message says why.
 *     The page's own lines are plain text and its one live region is #announcer (E3-2), so every
 *     line written here is announced through #announcer too, and emptied from it a few seconds
 *     later, as the page does.
 *
 * Send using email app needs nothing here: the page's mailto: link (To, Cc, subject and the whole
 * letter) reaches the app as a navigation, and the app hands its parts to the email app
 * (NavigationPolicy.mailDraft). The same goes for links that open a new tab: they go to the
 * browser.
 *
 * The channel is window.GLBridge, injected by the app through
 * WebViewCompat.addWebMessageListener and ONLY into pages from
 * https://appassets.androidplatform.net, the bundled app's own origin. Nothing here adds a Java
 * object to the page (no addJavascriptInterface), it carries text and bytes only (never an
 * address or a path), and the app checks every request again (OutgoingRequest.kt) before it
 * acts. Everything keeps the page's own Content Security Policy intact (connect-src 'none'): no
 * fetch, no XHR, nothing leaves the device through this script.
 *
 * THE MESSAGES (all JSON text; t is the type, id a positive whole number):
 *   page to app
 *     { t: 'hello', id }                    once, as this script starts: the app can reach the page
 *     { t: 'copy', id, text }
 *     { t: 'share', id, text }
 *     { t: 'save', id, name, mime, data }   data: base64 of the Blob's bytes
 *     { t: 'calendar', id, data }           data: base64 of the reminder's .ics
 *     { t: 'print', id, text, kind }        kind: 'letter' | 'follow-up' | 'timeline'
 *     { t: 'close', id: q }                 after Back q: close the app
 *     { t: 'stay', id: q }                  after Back q: the page closed one of its dialogs
 *     { t: 'ask', id: q }                   after Back q: something is typed; may the page ask?
 *   app to page
 *     { t: 'reply', id, ok }                the answer to one request; a save is answered once the
 *                                           file is written (ok), the save screen was left
 *                                           (cancelled: true) or another save still waits (busy: true)
 *     { t: 'back', q }                      Android's Back, on the letter page (q: its number)
 *     { t: 'ask-ok', q }                    the page may open its "Close the app?" dialog for Back q
 *     { t: 'no-email-app' }                 a mailto: link found no email app
 * No message longer than 450,000 characters is ever posted (OutgoingRequest.MAX_MESSAGE_CHARS).
 *
 * TypeScript since 29 October 2026, compiled by tools/build-ts.sh into android-bridge.js beside it
 * (the file the app bundles). It keeps the style it had as hand-written JavaScript (var, function,
 * one IIFE): the move added types only, so the compiled script is the same program as before.
 * The declarations below emit nothing.
 */

/** The message channel the app injects (WebViewCompat.addWebMessageListener): JSON text both ways. */
interface WebMessagePort {
  postMessage(message: string): void;
  addEventListener(type: 'message', listener: (ev: { data: string }) => void): void;
}
interface Window {
  /** Present only in the app, and only on the app's own origin. */
  readonly GLBridge?: WebMessagePort;
}
/** A message to the app (THE MESSAGES above, page to app). */
interface Outgoing {
  t: 'hello' | 'copy' | 'share' | 'save' | 'calendar' | 'print' | 'close' | 'stay' | 'ask';
  id?: number;
  text?: string;
  name?: string;
  mime?: string;
  data?: string;
  kind?: 'letter' | 'follow-up' | 'timeline';
}
/** The app's answer to one request, as settled here (or NO). */
interface Answer {
  ok: boolean;
  cancelled?: boolean;
  busy?: boolean;
}
/** A message from the app (THE MESSAGES above, app to page), as parsed: every field is checked before use. */
interface Incoming {
  t?: unknown;
  q?: unknown;
  id?: unknown;
  ok?: unknown;
  cancelled?: unknown;
  busy?: unknown;
}
/** The page's letter boxes and fields, as far as this script reads them. */
type TextBox = HTMLTextAreaElement | HTMLInputElement;

(function () {
  'use strict';

  /* ---------- 0. Website-only parts of the page ---------- */

  /* This runs before the check for window.GLBridge below, on purpose: it depends only on this
     file being loaded, which happens only inside the APK, so the website-only parts stay hidden
     even on a WebView too old for the message channel. The script loads in the head, before the
     body is parsed, so it waits for the end of parsing: readyState leaves 'loading' before
     gate.js and the app.js module run. A MutationObserver hides any data-web-only element the
     page adds later; its callback runs before the browser paints, so such a part is never
     shown, not even briefly. */
  function hideWebOnly(root: Node): void {
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1 && (root as HTMLElement).hasAttribute('data-web-only')) (root as HTMLElement).hidden = true;
    var els = (root as ParentNode).querySelectorAll<HTMLElement>('[data-web-only]');
    for (var i = 0; i < els.length; i++) els[i]!.hidden = true;
  }
  function watchWebOnly(): void {
    hideWebOnly(document);
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(function (records) {
      for (var r = 0; r < records.length; r++) {
        var rec = records[r]!;
        if (rec.type === 'attributes') {
          /* Something took the hidden attribute off a website-only part: put it back. */
          if (rec.target.nodeType === 1 && (rec.target as HTMLElement).hasAttribute('data-web-only') && !(rec.target as HTMLElement).hidden) (rec.target as HTMLElement).hidden = true;
          continue;
        }
        var added = rec.addedNodes;
        for (var n = 0; n < added.length; n++) hideWebOnly(added[n]!);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-web-only'] });
  }
  function whenParsed(fn: () => void): void {
    if (document.readyState === 'loading') {
      document.addEventListener('readystatechange', function onState() {
        if (document.readyState === 'loading') return;
        document.removeEventListener('readystatechange', onState);
        fn();
      });
    } else {
      fn();
    }
  }
  whenParsed(watchWebOnly);

  /* A WebView too old for the message channel (the app has also said so in a short message of
     its own): the page keeps the browser's own ways, which in a WebView may do nothing. */
  var bridge = window.GLBridge;
  if (!bridge || typeof bridge.postMessage !== 'function') return;

  /* The app refuses longer text (OutgoingRequest.MAX_TEXT_CHARS), larger files (MAX_FILE_BYTES),
     larger reminders (MAX_ICS_BYTES) and longer messages (MAX_MESSAGE_CHARS); refused here first. */
  var MAX_TEXT = 100000;
  var MAX_FILE = 300000;
  var MAX_ICS = 65536;
  var MAX_MESSAGE = 450000;

  /* The app's own words. Every one of them was approved for the app (16 October 2026), except
     PRINT_SCREEN, new with Save as PDF (30 October 2026). */
  var CALENDAR_LABEL = 'Add to calendar app';
  var CALENDAR_OPENING = 'Opening your calendar app.';
  var CALENDAR_OPENED = 'Your calendar app opens with the reminder. Set its alert there, then save it.';
  var CALENDAR_FAILED = 'No calendar app opened. Save the reminder instead, and open the file in your calendar.';
  var TOO_LONG = 'This is too long for the app to hand over. Shorten it and try again.';
  var SAVE_FAILED = 'The file could not be saved. Try Save again.';
  var PRINT_SCREEN = 'On the Android print screen, choose Save as PDF as the printer.';
  var CLOSE_QUESTION = 'Close the app? What you have typed will be lost.';
  var CLOSE_LABEL = 'Close';

  /* What post() throws for a message the app would refuse; only ever compared with instanceof. */
  function TooLong(): void {}

  function post(msg: Outgoing): void {
    var text = JSON.stringify(msg);
    if (text.length > MAX_MESSAGE) throw new (TooLong as unknown as new () => object)();
    bridge!.postMessage(text);
  }

  function toBase64(bytes: Uint8Array): string {
    var parts: string[] = [];
    var STEP = 0x8000;
    for (var i = 0; i < bytes.length; i += STEP) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + STEP, bytes.length)) as unknown as number[]));
    }
    return btoa(parts.join(''));
  }

  /* Requests waiting for the app's answer, by id. An answer that has not come in this long
     counts as a refusal, so the page never hangs; a save waits as long as the save screen is
     open, because the app answers it only once the person has chosen. */
  var nextId = 1;
  var waiting = new Map<number, (answer: Answer) => void>();
  var TIMEOUT_MS = 8000;
  var NO: Answer = { ok: false };

  /* Sends one request; resolves with the app's answer ({ ok, cancelled, busy }), or NO. */
  function ask(msg: Outgoing, wait?: number): Promise<Answer> {
    var limit = wait === undefined ? TIMEOUT_MS : wait;
    return new Promise<Answer>(function (resolve) {
      var id = nextId++;
      msg.id = id;
      var timer = limit ? window.setTimeout(function () {
        if (waiting.delete(id)) resolve(NO);
      }, limit) : 0;
      waiting.set(id, function (answer) {
        window.clearTimeout(timer);
        resolve(answer);
      });
      try {
        post(msg);
      } catch (e) {
        window.clearTimeout(timer);
        waiting.delete(id);
        if (e instanceof TooLong) {
          /* After the page's own line about the refusal, which it writes once this settles. */
          var status = lastStatus;
          window.setTimeout(function () { tell(status, TOO_LONG); }, 0);
        }
        resolve(NO);
      }
    });
  }

  /* An answer about Back (close, stay, ask), which carries the number of the app's Back query. */
  function answerBack(t: 'close' | 'stay' | 'ask', q: number): void {
    try { post({ t: t, id: q }); } catch (e) { /* nothing to tell */ }
  }

  var isText = function (x: unknown): boolean { return typeof x === 'string' && x.length > 0 && x.length <= MAX_TEXT; };

  function refused(name: string): Error {
    var e = new Error('The app did not ' + name + '.');
    e.name = 'NotAllowedError';
    return e;
  }

  /* ---------- What the page says ---------- */

  /* The page's one live region, used as the page uses it (ts/app.ts, announce): emptied, filled 50 ms
     later, and emptied again a few seconds after, unless something newer is there by then. */
  var announceTimer = 0;
  function announce(text: string): void {
    var el = document.getElementById('announcer');
    if (!el) return;
    window.clearTimeout(announceTimer);
    el.textContent = '';
    announceTimer = window.setTimeout(function () {
      el!.textContent = text;
      window.setTimeout(function () { if (el!.textContent === text) el!.textContent = ''; }, 4000);
    }, 50);
  }

  /* A status line written by the app's side, and announced. */
  function tell(status: HTMLElement | null, text: string): void {
    if (status) status.textContent = text;
    announce(text);
  }

  /* The status line under the buttons a press came from: the .status paragraph after the row of
     buttons, as the page lays out each of its five rows. */
  function statusFor(button: HTMLElement): HTMLElement | null {
    var row = button.closest('.actions');
    var line = row ? row.nextElementSibling : null;
    return line && line.classList.contains('status') ? line as HTMLElement : null;
  }

  /* Which box each output button hands over (ts/app.ts, wire). */
  var SOURCES: Record<string, string> = {
    'copy-letter': 'letter', 'open-email': 'letter', 'print': 'letter', 'save-txt': 'letter', 'share': 'letter',
    'fu-copy': 'fu-letter', 'fu-email': 'fu-letter', 'fu-print': 'fu-letter', 'fu-save': 'fu-letter', 'fu-share': 'fu-letter',
    'tl-copy': 'tl-text', 'tl-print': 'tl-text', 'tl-save': 'tl-text', 'tl-share': 'tl-text'
  };

  /* The status line of the latest press, and of the latest press on Send using email app. */
  var lastStatus: HTMLElement | null = null;
  var emailStatus: HTMLElement | null = null;

  /* ---------- 1. Copy ---------- */

  function writeText(text: string): Promise<void> {
    var s = String(text);
    if (!isText(s)) return Promise.reject(refused('copy'));
    return ask({ t: 'copy', text: s }).then(function (answer) {
      if (answer.ok !== true) throw refused('copy');
    });
  }
  var clip = navigator.clipboard;
  if (clip) {
    Object.defineProperty(clip, 'writeText', { value: writeText, writable: false, configurable: false, enumerable: false });
  } else {
    Object.defineProperty(navigator, 'clipboard', { value: Object.freeze({ writeText: writeText }), writable: false, configurable: false, enumerable: false });
  }

  /* ---------- 2. Share ---------- */

  function share(data?: ShareData): Promise<void> {
    var text = data && typeof data === 'object' ? data.text : undefined;
    if (!isText(text)) return Promise.reject(new TypeError('Only text can be shared.'));
    return ask({ t: 'share', text: text }).then(function (answer) {
      if (answer.ok !== true) throw refused('share');
    });
  }
  Object.defineProperty(navigator, 'share', { value: share, writable: false, configurable: false, enumerable: false });

  /* ---------- 3. Save, and 5. the calendar ---------- */

  /* Remember which Blob each blob: address stands for, so a click can hand over the bytes
     without fetching the address (the page forbids fetch, and rightly). */
  var blobs = new Map<string, Blob>();
  var nativeCreate = URL.createObjectURL;
  var nativeRevoke = URL.revokeObjectURL;
  URL.createObjectURL = function (obj: Blob | MediaSource): string {
    var url = nativeCreate.call(URL, obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = function (url: string): void {
    blobs.delete(url);
    return nativeRevoke.call(URL, url);
  };

  /* Set while a press on Add to calendar app clicks the page's Save a reminder button: the
     reminder then goes to the calendar app instead of the save screen. */
  var calendarNext: ((answer: Answer) => void) | null = null;

  /* What the line under the buttons says once the app has answered a save (E3-4). */
  function saved(status: HTMLElement | null, answer: Answer): void {
    if (answer.ok === true || answer.busy === true) return;
    if (answer.cancelled === true) {
      if (status) status.textContent = '';
      return;
    }
    /* The app's short message says it too, and is read out; the line keeps it on screen. */
    if (status) status.textContent = SAVE_FAILED;
  }

  document.addEventListener('click', function (ev) {
    var target = ev.target as Element | null;
    var button = target && target.closest ? target.closest('button') : null;
    if (button) {
      lastStatus = statusFor(button);
      var box = SOURCES[button.id] ? document.getElementById(SOURCES[button.id]!) as TextBox | null : null;
      if (box && box.value.length > MAX_TEXT) {
        /* Refused before the page acts, so it never says it copied, printed or saved (A3-5, E3-6). */
        ev.preventDefault();
        ev.stopImmediatePropagation();
        tell(lastStatus, TOO_LONG);
        return;
      }
      if (button.id === 'open-email' || button.id === 'fu-email') emailStatus = lastStatus;
      return;
    }
    var link = target && target.closest ? target.closest<HTMLAnchorElement>('a[download]') : null;
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (href.indexOf('blob:') !== 0) return;
    ev.preventDefault();
    var blob = blobs.get(link.href) || blobs.get(href);
    var calendar = calendarNext;
    calendarNext = null;
    var status = lastStatus;
    if (!blob || !blob.size) {
      if (calendar) calendar(NO);
      return;
    }
    if (blob.size > (calendar ? MAX_ICS : MAX_FILE)) {
      if (calendar) calendar(NO);
      /* After the page's own "Saved as ..." line, which it writes once this click returns. */
      window.setTimeout(function () { tell(status, TOO_LONG); }, 0);
      return;
    }
    var name = link.getAttribute('download') || '';
    blob.arrayBuffer().then(function (buf) {
      var data = toBase64(new Uint8Array(buf));
      if (calendar) {
        ask({ t: 'calendar', data: data }).then(calendar);
      } else {
        ask({ t: 'save', name: name, mime: blob!.type || '', data: data }, 0).then(function (answer) { saved(status, answer); });
      }
    }, function () {
      if (calendar) calendar(NO);
      else saved(status, NO);
    });
  }, true);

  /* One Add to calendar app button beside one of the page's Save a reminder buttons. */
  function addCalendarButton(saveId: string, statusId: string): void {
    var save = document.getElementById(saveId) as HTMLButtonElement | null;
    var status = document.getElementById(statusId);
    if (!save || !status || document.getElementById(saveId + '-calendar')) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.id = saveId + '-calendar';
    button.className = save.className.replace('btn-primary', 'btn-secondary');
    button.textContent = CALENDAR_LABEL;
    button.addEventListener('click', function () {
      if (save!.disabled) return;
      calendarNext = function (answer) {
        tell(status, answer.ok === true ? CALENDAR_OPENED : CALENDAR_FAILED);
      };
      var mark = calendarNext;
      save!.click();
      if (calendarNext === mark) {
        /* No Save link was clicked: the page has said what is missing. */
        calendarNext = null;
        return;
      }
      /* The page's "Saved as ..." line, just written, is not true of a reminder sent to the
         calendar app: it is replaced at once, and again with the app's answer. */
      tell(status, CALENDAR_OPENING);
    });
    save.insertAdjacentElement('afterend', button);
    /* The page disables its Save a reminder button while there is no deadline to remind of;
       this button follows it, so it is never offered when it could do nothing. */
    var follow = function () { button.disabled = save!.disabled; };
    follow();
    if (typeof MutationObserver === 'function') new MutationObserver(follow).observe(save, { attributes: true, attributeFilter: ['disabled'] });
  }

  whenParsed(function () {
    addCalendarButton('save-ics', 'ics-status');
    addCalendarButton('save-ics-ext', 'ext-status');
  });

  /* ---------- 4. Print ---------- */

  /* Which of the page's three boxes the print box holds (ts/app.ts, printSource). */
  function printKind(text: string): 'letter' | 'follow-up' | 'timeline' {
    var fu = document.getElementById('fu-letter') as TextBox | null;
    var tl = document.getElementById('tl-text') as TextBox | null;
    if (fu && fu.value === text && fu.value !== (document.getElementById('letter') as TextBox | null || {} as Partial<TextBox>).value) return 'follow-up';
    if (tl && tl.value === text && tl.value !== (document.getElementById('letter') as TextBox | null || {} as Partial<TextBox>).value) return 'timeline';
    return 'letter';
  }

  function print(): void {
    window.dispatchEvent(new Event('beforeprint'));
    var box = document.getElementById('print-letter');
    var text = box ? box.textContent as string : '';
    window.dispatchEvent(new Event('afterprint'));
    if (!isText(text)) {
      if (text.length > MAX_TEXT) tell(lastStatus, TOO_LONG);
      return;
    }
    var status = lastStatus;
    tell(status, PRINT_SCREEN);
    ask({ t: 'print', text: text, kind: printKind(text) }).then(function (answer) {
      if (answer.ok !== true && status && status.textContent === PRINT_SCREEN) status.textContent = '';
    });
  }
  Object.defineProperty(window, 'print', { value: print, writable: false, configurable: false, enumerable: false });

  /* ---------- 6. Back ---------- */

  /* Something the person would lose: a field holding text, or a letter box they have edited. The
     three letter boxes are filled in by the page itself, so they count only once edited. */
  var OUTPUT_BOXES = ['letter', 'fu-letter', 'tl-text'];
  function typedSomething(): boolean {
    var fields = document.querySelectorAll<TextBox>('main input[type="text"], main input[type="email"], main textarea');
    for (var i = 0; i < fields.length; i++) {
      if (OUTPUT_BOXES.indexOf(fields[i]!.id) < 0 && fields[i]!.value.trim() !== '') return true;
    }
    var edited = ['letter-edited', 'fu-edited', 'tl-edited'];
    for (var j = 0; j < edited.length; j++) {
      var note = document.getElementById(edited[j]!);
      if (note && !note.hidden) return true;
    }
    return false;
  }

  /* True when the page's own confirmation dialog can ask. */
  function canAsk(dialog: HTMLDialogElement | null): dialog is HTMLDialogElement {
    return !!(dialog && document.getElementById('confirm-text') && document.getElementById('confirm-ok')
      && document.getElementById('confirm-cancel') && typeof dialog.showModal === 'function');
  }

  /* The page's own confirmation dialog (ts/app.ts, confirmFirst), with the app's question, for Back q. */
  function askBeforeClosing(dialog: HTMLDialogElement | null, q: number): boolean {
    var text = document.getElementById('confirm-text')!;
    var ok = document.getElementById('confirm-ok')!;
    var cancel = document.getElementById('confirm-cancel')!;
    if (!canAsk(dialog) || dialog.open) return false;
    var before = document.activeElement as HTMLElement | null;
    text.textContent = CLOSE_QUESTION;
    ok.textContent = CLOSE_LABEL;
    var done = function (close: boolean): void {
      ok.removeEventListener('click', yes);
      cancel.removeEventListener('click', no);
      dialog!.removeEventListener('cancel', no);
      if (dialog!.open) dialog!.close();
      if (close) answerBack('close', q);
      else if (before && typeof before.focus === 'function' && before !== document.body) before.focus();
    };
    var yes = function () { done(true); };
    var no = function () { done(false); };
    ok.addEventListener('click', yes);
    cancel.addEventListener('click', no);
    dialog.addEventListener('cancel', no);
    dialog.showModal();
    cancel.focus();
    return true;
  }

  /* The Back query the page asked about and may still open its dialog for, or 0. */
  var askingFor = 0;

  function onBack(q: number): void {
    askingFor = 0;
    var dialog = document.getElementById('confirm-dialog') as HTMLDialogElement | null;
    if (dialog && dialog.open) {
      /* Back closes an open dialog, as Cancel does. */
      var cancel = document.getElementById('confirm-cancel');
      if (cancel) cancel.click();
      else dialog.close();
      answerBack('stay', q);
      return;
    }
    if (canAsk(dialog) && typedSomething()) {
      /* The dialog opens only when the app agrees (ask-ok), never after the app has asked itself. */
      askingFor = q;
      answerBack('ask', q);
      return;
    }
    answerBack('close', q);
  }

  function onAskOk(q: number): void {
    if (q !== askingFor) return;
    askingFor = 0;
    var dialog = document.getElementById('confirm-dialog') as HTMLDialogElement | null;
    /* Another of the page's dialogs opened meanwhile: that one stays, and the app stays open. */
    if (dialog && dialog.open) return;
    if (!askBeforeClosing(dialog, q)) answerBack('close', q);
  }

  var isQuery = function (q: unknown): q is number { return typeof q === 'number' && q > 0 && q <= 0x7fffffff && Math.floor(q) === q; };

  /* ---------- Messages from the app ---------- */

  bridge.addEventListener('message', function (ev) {
    var msg: Incoming;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'back') {
      if (isQuery(msg.q)) onBack(msg.q);
      return;
    }
    if (msg.t === 'ask-ok') {
      if (isQuery(msg.q)) onAskOk(msg.q);
      return;
    }
    if (msg.t === 'no-email-app') {
      /* The page said the email app should open a draft; it did not. */
      if (emailStatus) emailStatus.textContent = '';
      return;
    }
    if (msg.t !== 'reply') return;
    var settle = waiting.get(msg.id as number);
    if (!settle) return;
    waiting.delete(msg.id as number);
    settle({ ok: msg.ok === true, cancelled: msg.cancelled === true, busy: msg.busy === true });
  });

  /* The app can reach the page from now on (Back, a missing email app). */
  ask({ t: 'hello' });
})();
