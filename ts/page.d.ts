// Types for the page's own elements, for the type check only (tools/build-ts.sh). Emits nothing and
// is never published: _config.yml excludes ts/, and the Android build bundles only the files on its
// include list.
//
// tests/static.test.ts reads this file and checks every entry against index.html (the element
// with that id, or that class inside the row templates, and its tag), so these types cannot drift
// from the page.

/** The elements app.ts looks up by id, as index.html declares them. */
interface PageElements {
  'address': HTMLTextAreaElement;
  'announcer': HTMLDivElement;
  'based-no': HTMLInputElement;
  'channel-email': HTMLInputElement;
  'clear': HTMLButtonElement;
  'company': HTMLInputElement;
  'company-address': HTMLTextAreaElement;
  'company-email': HTMLInputElement;
  'company-email-warn': HTMLParagraphElement;
  'confirm-cancel': HTMLButtonElement;
  'confirm-dialog': HTMLDialogElement;
  'confirm-ok': HTMLButtonElement;
  'confirm-text': HTMLParagraphElement;
  'consultations': HTMLInputElement;
  'copy-electronic': HTMLInputElement;
  'copy-first': HTMLInputElement;
  'copy-letter': HTMLButtonElement;
  'deadline-result': HTMLDivElement;
  'dpo': HTMLInputElement;
  'email': HTMLInputElement;
  'email-warn': HTMLParagraphElement;
  'ext-status': HTMLParagraphElement;
  'fu-answer-date': HTMLInputElement;
  'fu-answer-field': HTMLDivElement;
  'fu-asked-document': HTMLInputElement;
  'fu-attach': HTMLParagraphElement;
  'fu-body': HTMLDivElement;
  'fu-check': HTMLParagraphElement;
  'fu-copy': HTMLButtonElement;
  'fu-date': HTMLInputElement;
  'fu-edited': HTMLDivElement;
  'fu-email': HTMLButtonElement;
  'fu-erased-hint': HTMLParagraphElement;
  'fu-ext-late': HTMLInputElement;
  'fu-ext-reasons': HTMLInputElement;
  'fu-from-email': HTMLInputElement;
  'fu-items': HTMLDivElement;
  'fu-lang-en': HTMLInputElement;
  'fu-lang-nb': HTMLInputElement;
  'fu-letter': HTMLTextAreaElement;
  'fu-letter-wrap': HTMLDivElement;
  'fu-logged-in': HTMLInputElement;
  'fu-missing': HTMLParagraphElement;
  'fu-nothing': HTMLParagraphElement;
  'fu-print': HTMLButtonElement;
  'fu-rebuild': HTMLButtonElement;
  'fu-received-date': HTMLInputElement;
  'fu-received-field': HTMLDivElement;
  'fu-received-opt': HTMLSpanElement;
  'fu-ref-16': HTMLInputElement;
  'fu-ref-16-hint': HTMLParagraphElement;
  'fu-ref-16-row': HTMLLabelElement;
  'fu-ref-complaint': HTMLInputElement;
  'fu-ref-reasons': HTMLInputElement;
  'fu-refused-all': HTMLInputElement;
  'fu-request-date': HTMLInputElement;
  'fu-save': HTMLButtonElement;
  'fu-share': HTMLButtonElement;
  'fu-status': HTMLParagraphElement;
  'ground-a': HTMLInputElement;
  'ground-b': HTMLInputElement;
  'ground-c': HTMLInputElement;
  'ground-d': HTMLInputElement;
  'ground-d-field': HTMLDivElement;
  'ground-d-text': HTMLInputElement;
  'ground-d-text-warn': HTMLParagraphElement;
  'ground-e': HTMLInputElement;
  'ground-f': HTMLInputElement;
  'ics-leave-out': HTMLInputElement;
  'ics-status': HTMLParagraphElement;
  'id-add': HTMLButtonElement;
  'id-row-template': HTMLTemplateElement;
  'id-rows': HTMLDivElement;
  'kind-access': HTMLInputElement;
  'lang-en': HTMLInputElement;
  'lang-nb': HTMLInputElement;
  'letter': HTMLTextAreaElement;
  'letter-date': HTMLInputElement;
  'letter-edited': HTMLDivElement;
  'made-public': HTMLInputElement;
  'main': HTMLElement;
  'missing': HTMLParagraphElement;
  'name': HTMLInputElement;
  'open-email': HTMLButtonElement;
  'out-status': HTMLParagraphElement;
  'outside-note': HTMLDivElement;
  'posted': HTMLInputElement;
  'posted-field': HTMLDivElement;
  'print': HTMLButtonElement;
  'print-letter': HTMLDivElement;
  'rebuild': HTMLButtonElement;
  'received': HTMLInputElement;
  'reply-email': HTMLInputElement;
  'save-ics': HTMLButtonElement;
  'save-ics-ext': HTMLButtonElement;
  'save-txt': HTMLButtonElement;
  'scope-all': HTMLInputElement;
  'scope-field': HTMLDivElement;
  'scope-text': HTMLInputElement;
  'scope-text-warn': HTMLParagraphElement;
  'share': HTMLButtonElement;
  'tell-recipients': HTMLInputElement;
  'tl-add': HTMLButtonElement;
  'tl-copy': HTMLButtonElement;
  'tl-date': HTMLInputElement;
  'tl-edited': HTMLDivElement;
  'tl-lang-nb': HTMLInputElement;
  'tl-missing': HTMLTextAreaElement;
  'tl-missing-parts': HTMLParagraphElement;
  'tl-missing-warn': HTMLParagraphElement;
  'tl-other-empty': HTMLParagraphElement;
  'tl-print': HTMLButtonElement;
  'tl-rebuild': HTMLButtonElement;
  'tl-row-template': HTMLTemplateElement;
  'tl-rows': HTMLDivElement;
  'tl-save': HTMLButtonElement;
  'tl-share': HTMLButtonElement;
  'tl-status': HTMLParagraphElement;
  'tl-text': HTMLTextAreaElement;
  'tl-undated': HTMLParagraphElement;
}

type PageId = keyof PageElements;

/** document.getElementById for the page's own ids: every one of them is in index.html. */
type PageLookup = <K extends PageId>(id: K) => PageElements[K];

/** The parts of a details row and of a timeline row, by class, as the row templates hold them. */
interface RowParts {
  '.id-row': HTMLDivElement;
  '.id-label-label': HTMLLabelElement;
  '.id-label': HTMLSelectElement;
  '.id-value-label': HTMLLabelElement;
  '.id-value': HTMLInputElement;
  '.id-warn': HTMLParagraphElement;
  '.id-remove': HTMLButtonElement;
  '.tl-row': HTMLDivElement;
  '.tl-date-label': HTMLLabelElement;
  '.tl-date': HTMLInputElement;
  '.tl-type-label': HTMLLabelElement;
  '.tl-type': HTMLSelectElement;
  '.tl-note-label': HTMLLabelElement;
  '.tl-note': HTMLInputElement;
  '.tl-warn': HTMLParagraphElement;
  '.tl-attach': HTMLInputElement;
  '.tl-attach-label': HTMLSpanElement;
  '.tl-remove': HTMLButtonElement;
}

// A row is always a copy of its template, so each of these classes is always found in it.
interface ParentNode {
  querySelector<S extends keyof RowParts>(selectors: S): RowParts[S];
}
