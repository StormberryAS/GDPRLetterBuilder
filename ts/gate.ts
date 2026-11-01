/*! STORMBERRY FIRST-RUN GATE (behaviour). GDPRLetterBuilder, dismissible tier.
    GENERATED FILE: build-gates.py at the root of the GitHub folder writes this TypeScript; a
    TypeScript app compiles it with its own build (tools/build-ts.sh), and for a JavaScript app
    build-gates.py compiles it with tsc. Edit build-gates.py and run it again; never edit gate.ts
    or gate.js. */

(function (): void {
  'use strict';

  const APP_ID = 'gdprletterbuilder';
  const VERSION = '2';
  /* Typed as boolean so that both tiers compile from the same text. */
  const MANDATORY: boolean = false;

  /* The version rides in the key so that materially new wording re-prompts
     someone who already accepted the old wording. */
  const STORE_KEY = 'sb-gate:' + APP_ID + ':v' + VERSION;

  /* Storage throws outright in private mode and wherever the user has blocked
     it. We read that as "not seen yet" rather than failing: the gate keeps
     working, it simply cannot remember, so it shows again next visit. That is
     the safe direction to fail in for a warning. */
  function alreadySeen(): boolean {
    try {
      return window.localStorage.getItem(STORE_KEY) !== null;
    } catch (err) {
      return false;
    }
  }

  function markSeen(): void {
    try {
      window.localStorage.setItem(STORE_KEY, new Date().toISOString());
    } catch (err) {
      /* Nothing to do. The gate shows again next time, which is acceptable. */
    }
  }

  if (alreadySeen()) return;

  const TITLE_ID = 'sb-gate-title';
  const BODY_ID = 'sb-gate-body';
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const overlay = document.createElement('div');
  overlay.className = 'sb-gate-overlay';
  overlay.setAttribute('data-tier', MANDATORY ? 'mandatory' : 'dismissible');

  const dialog = document.createElement('div');
  dialog.className = 'sb-gate-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', TITLE_ID);
  dialog.setAttribute('aria-describedby', BODY_ID);
  /* Focusable so the trap always has somewhere to put focus back. */
  dialog.tabIndex = -1;

  dialog.innerHTML = [
    '<p class="sb-gate-kicker">Prototype</p>',
    '<h2 class="sb-gate-title" id="' + TITLE_ID + '">Before you use GDPRLetterBuilder</h2>',
    '<div class="sb-gate-scroll">',
    '<div class="sb-gate-body" id="' + BODY_ID + '">',
    '<p>This is a functioning prototype, published to show what Stormberry AS builds. It is not a certified instrument, not a professional service, and not a substitute for an authoritative source.</p>',
    '<p>It is <strong>not a finished product</strong>, it is not maintained as one, and <strong>it will eventually stop working</strong>: data moves, interfaces change, and nothing here is kept in step with them. Its purpose is to show a potential use of AI, making a possibility visible quickly so it can be judged and then built properly if it is worth building.</p>',
    '<p><strong>Information, not legal advice.</strong> It fills in standard letters based on the GDPR and on guidance from data protection authorities, checked on the date shown at the foot of the page. It cannot judge your situation, and a company may lawfully refuse some requests or keep some data.</p>',
    '<p>It sends nothing. You read the letter, change what you need and send it yourself.</p>',
    '</div>',
    '</div>',
    '<p class="sb-gate-ack">I understand this is a prototype. It gives information, not legal advice, and I will check the letter and send it myself.</p>',
    '<div class="sb-gate-actions">',
    '<button type="button" class="sb-gate-btn">Got it</button>',
    '<a class="sb-gate-link" href="disclaimer.html">Read the full disclaimer</a>',
    '</div>'
  ].join('');

  overlay.appendChild(dialog);

  let previouslyFocused: HTMLElement | null = null;
  let hidden: { el: HTMLElement; aria: string | null }[] = [];
  let nudgeTimer = 0;
  let pressedOnBackdrop = false;

  /* Array.prototype.slice.call, as before, rather than Array.from: the same
     expression at run time. Every match of FOCUSABLE is an HTML element. */
  function focusables(): HTMLElement[] {
    return Array.prototype.slice.call(dialog.querySelectorAll(FOCUSABLE));
  }

  /* Everything else on the page is taken out of the tab order and out of the
     accessibility tree while the dialog is up. inert also kills pointer events,
     which is what makes "not usable until accepted" true rather than merely
     visual. aria-hidden covers the browsers that lack inert. */
  function hideBackground(): void {
    const kids: HTMLElement[] = Array.prototype.slice.call(document.body.children);
    kids.forEach(function (el) {
      if (el === overlay) return;
      hidden.push({ el: el, aria: el.getAttribute('aria-hidden') });
      el.setAttribute('aria-hidden', 'true');
      el.inert = true;
    });
  }

  function restoreBackground(): void {
    hidden.forEach(function (rec) {
      if (rec.aria === null) {
        rec.el.removeAttribute('aria-hidden');
      } else {
        rec.el.setAttribute('aria-hidden', rec.aria);
      }
      rec.el.inert = false;
    });
    hidden = [];
  }

  /* Refusal needs to be felt, not silent. CSS decides whether that is a shake
     or, under prefers-reduced-motion, a still border flash. */
  function nudge(): void {
    dialog.classList.remove('is-nudged');
    /* Reading a layout property restarts the animation on a re-added class. */
    void dialog.offsetWidth;
    dialog.classList.add('is-nudged');
    window.clearTimeout(nudgeTimer);
    nudgeTimer = window.setTimeout(function () {
      dialog.classList.remove('is-nudged');
    }, 600);
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' || ev.key === 'Esc') {
      ev.preventDefault();
      if (MANDATORY) {
        nudge();
      } else {
        close();
      }
      return;
    }

    if (ev.key !== 'Tab') return;

    const items = focusables();
    if (items.length === 0) {
      ev.preventDefault();
      dialog.focus();
      return;
    }
    /* Both exist: the list is not empty (checked just above). */
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const here = document.activeElement;
    if (ev.shiftKey && (here === first || here === dialog)) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && here === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  /* Belt and braces for the trap: anything that lands focus outside the dialog,
     including content the app renders after the gate opened, is pulled back.
     The target of a focusin event is a node (or null, which contains() refuses). */
  function onFocusIn(ev: FocusEvent): void {
    if (!dialog.contains(ev.target as Node | null)) {
      dialog.focus();
    }
  }

  function open(): void {
    /* Kept as found; close() checks that it can still take focus before it
       calls focus(), so an element of any kind is handled as before. */
    previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.appendChild(overlay);
    hideBackground();
    document.documentElement.classList.add('sb-gate-open');
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('focusin', onFocusIn, true);
    /* Focus the dialog itself rather than the first control. A screen reader
       then reads the title and the whole warning before it reaches the button,
       which is the point of the gate. From here Tab moves through the
       dialog in order: any link in the warning, the button, then the link
       to the full disclaimer. */
    dialog.focus();
  }

  function close(): void {
    markSeen();
    window.clearTimeout(nudgeTimer);
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.documentElement.classList.remove('sb-gate-open');
    restoreBackground();
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);

    if (previouslyFocused && document.contains(previouslyFocused) &&
        typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus();
    } else if (document.body) {
      /* Nothing sensible to return to, so park focus at the top of the page
         instead of leaving it on a removed node. */
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    }
  }

  /* The button is in the markup that dialog.innerHTML received above. */
  dialog.querySelector('.sb-gate-btn')!.addEventListener('click', close);

  /* The press has to both start and end on the backdrop, so a text selection
     dragged out of the dialog does not read as a dismissal. */
  overlay.addEventListener('pointerdown', function (ev) {
    pressedOnBackdrop = ev.target === overlay;
  });

  overlay.addEventListener('click', function (ev) {
    if (ev.target !== overlay) return;
    if (!pressedOnBackdrop) return;
    pressedOnBackdrop = false;
    if (MANDATORY) {
      nudge();
    } else {
      close();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', open, { once: true });
  } else {
    open();
  }
}());
