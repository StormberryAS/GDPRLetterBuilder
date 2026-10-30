"use strict";
/*! android-bridge.js is compiled from android-bridge.ts beside it by tools/build-ts.sh, which leaves
    out every comment but this one: the explanations are in the source. Edit the .ts, never the .js:
    the build refuses to overwrite a hand edit, and its check mode fails on one. */
(function () {
    'use strict';
    function hideWebOnly(root) {
        if (root.nodeType !== 1 && root.nodeType !== 9)
            return;
        if (root.nodeType === 1 && root.hasAttribute('data-web-only'))
            root.hidden = true;
        var els = root.querySelectorAll('[data-web-only]');
        for (var i = 0; i < els.length; i++)
            els[i].hidden = true;
    }
    function watchWebOnly() {
        hideWebOnly(document);
        if (typeof MutationObserver !== 'function')
            return;
        new MutationObserver(function (records) {
            for (var r = 0; r < records.length; r++) {
                var rec = records[r];
                if (rec.type === 'attributes') {
                    if (rec.target.nodeType === 1 && rec.target.hasAttribute('data-web-only') && !rec.target.hidden)
                        rec.target.hidden = true;
                    continue;
                }
                var added = rec.addedNodes;
                for (var n = 0; n < added.length; n++)
                    hideWebOnly(added[n]);
            }
        }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-web-only'] });
    }
    function whenParsed(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('readystatechange', function onState() {
                if (document.readyState === 'loading')
                    return;
                document.removeEventListener('readystatechange', onState);
                fn();
            });
        }
        else {
            fn();
        }
    }
    whenParsed(watchWebOnly);
    var bridge = window.GLBridge;
    if (!bridge || typeof bridge.postMessage !== 'function')
        return;
    var MAX_TEXT = 100000;
    var MAX_FILE = 300000;
    var MAX_ICS = 65536;
    var MAX_MESSAGE = 450000;
    var CALENDAR_LABEL = 'Add to calendar app';
    var CALENDAR_OPENING = 'Opening your calendar app.';
    var CALENDAR_OPENED = 'Your calendar app opens with the reminder. Set its alert there, then save it.';
    var CALENDAR_FAILED = 'No calendar app opened. Save the reminder instead, and open the file in your calendar.';
    var TOO_LONG = 'This is too long for the app to hand over. Shorten it and try again.';
    var SAVE_FAILED = 'The file could not be saved. Try Save again.';
    var PRINT_SCREEN = 'On the Android print screen, choose Save as PDF as the printer.';
    var CLOSE_QUESTION = 'Close the app? What you have typed will be lost.';
    var CLOSE_LABEL = 'Close';
    function TooLong() { }
    function post(msg) {
        var text = JSON.stringify(msg);
        if (text.length > MAX_MESSAGE)
            throw new TooLong();
        bridge.postMessage(text);
    }
    function toBase64(bytes) {
        var parts = [];
        var STEP = 0x8000;
        for (var i = 0; i < bytes.length; i += STEP) {
            parts.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + STEP, bytes.length))));
        }
        return btoa(parts.join(''));
    }
    var nextId = 1;
    var waiting = new Map();
    var TIMEOUT_MS = 8000;
    var NO = { ok: false };
    function ask(msg, wait) {
        var limit = wait === undefined ? TIMEOUT_MS : wait;
        return new Promise(function (resolve) {
            var id = nextId++;
            msg.id = id;
            var timer = limit ? window.setTimeout(function () {
                if (waiting.delete(id))
                    resolve(NO);
            }, limit) : 0;
            waiting.set(id, function (answer) {
                window.clearTimeout(timer);
                resolve(answer);
            });
            try {
                post(msg);
            }
            catch (e) {
                window.clearTimeout(timer);
                waiting.delete(id);
                if (e instanceof TooLong) {
                    var status = lastStatus;
                    window.setTimeout(function () { tell(status, TOO_LONG); }, 0);
                }
                resolve(NO);
            }
        });
    }
    function answerBack(t, q) {
        try {
            post({ t: t, id: q });
        }
        catch (e) { }
    }
    var isText = function (x) { return typeof x === 'string' && x.length > 0 && x.length <= MAX_TEXT; };
    function refused(name) {
        var e = new Error('The app did not ' + name + '.');
        e.name = 'NotAllowedError';
        return e;
    }
    var announceTimer = 0;
    function announce(text) {
        var el = document.getElementById('announcer');
        if (!el)
            return;
        window.clearTimeout(announceTimer);
        el.textContent = '';
        announceTimer = window.setTimeout(function () {
            el.textContent = text;
            window.setTimeout(function () { if (el.textContent === text)
                el.textContent = ''; }, 4000);
        }, 50);
    }
    function tell(status, text) {
        if (status)
            status.textContent = text;
        announce(text);
    }
    function statusFor(button) {
        var row = button.closest('.actions');
        var line = row ? row.nextElementSibling : null;
        return line && line.classList.contains('status') ? line : null;
    }
    var SOURCES = {
        'copy-letter': 'letter', 'open-email': 'letter', 'print': 'letter', 'save-txt': 'letter', 'share': 'letter',
        'fu-copy': 'fu-letter', 'fu-email': 'fu-letter', 'fu-print': 'fu-letter', 'fu-save': 'fu-letter', 'fu-share': 'fu-letter',
        'tl-copy': 'tl-text', 'tl-print': 'tl-text', 'tl-save': 'tl-text', 'tl-share': 'tl-text'
    };
    var lastStatus = null;
    var emailStatus = null;
    function writeText(text) {
        var s = String(text);
        if (!isText(s))
            return Promise.reject(refused('copy'));
        return ask({ t: 'copy', text: s }).then(function (answer) {
            if (answer.ok !== true)
                throw refused('copy');
        });
    }
    var clip = navigator.clipboard;
    if (clip) {
        Object.defineProperty(clip, 'writeText', { value: writeText, writable: false, configurable: false, enumerable: false });
    }
    else {
        Object.defineProperty(navigator, 'clipboard', { value: Object.freeze({ writeText: writeText }), writable: false, configurable: false, enumerable: false });
    }
    function share(data) {
        var text = data && typeof data === 'object' ? data.text : undefined;
        if (!isText(text))
            return Promise.reject(new TypeError('Only text can be shared.'));
        return ask({ t: 'share', text: text }).then(function (answer) {
            if (answer.ok !== true)
                throw refused('share');
        });
    }
    Object.defineProperty(navigator, 'share', { value: share, writable: false, configurable: false, enumerable: false });
    var blobs = new Map();
    var nativeCreate = URL.createObjectURL;
    var nativeRevoke = URL.revokeObjectURL;
    URL.createObjectURL = function (obj) {
        var url = nativeCreate.call(URL, obj);
        if (obj instanceof Blob)
            blobs.set(url, obj);
        return url;
    };
    URL.revokeObjectURL = function (url) {
        blobs.delete(url);
        return nativeRevoke.call(URL, url);
    };
    var calendarNext = null;
    function saved(status, answer) {
        if (answer.ok === true || answer.busy === true)
            return;
        if (answer.cancelled === true) {
            if (status)
                status.textContent = '';
            return;
        }
        if (status)
            status.textContent = SAVE_FAILED;
    }
    document.addEventListener('click', function (ev) {
        var target = ev.target;
        var button = target && target.closest ? target.closest('button') : null;
        if (button) {
            lastStatus = statusFor(button);
            var box = SOURCES[button.id] ? document.getElementById(SOURCES[button.id]) : null;
            if (box && box.value.length > MAX_TEXT) {
                ev.preventDefault();
                ev.stopImmediatePropagation();
                tell(lastStatus, TOO_LONG);
                return;
            }
            if (button.id === 'open-email' || button.id === 'fu-email')
                emailStatus = lastStatus;
            return;
        }
        var link = target && target.closest ? target.closest('a[download]') : null;
        if (!link)
            return;
        var href = link.getAttribute('href') || '';
        if (href.indexOf('blob:') !== 0)
            return;
        ev.preventDefault();
        var blob = blobs.get(link.href) || blobs.get(href);
        var calendar = calendarNext;
        calendarNext = null;
        var status = lastStatus;
        if (!blob || !blob.size) {
            if (calendar)
                calendar(NO);
            return;
        }
        if (blob.size > (calendar ? MAX_ICS : MAX_FILE)) {
            if (calendar)
                calendar(NO);
            window.setTimeout(function () { tell(status, TOO_LONG); }, 0);
            return;
        }
        var name = link.getAttribute('download') || '';
        blob.arrayBuffer().then(function (buf) {
            var data = toBase64(new Uint8Array(buf));
            if (calendar) {
                ask({ t: 'calendar', data: data }).then(calendar);
            }
            else {
                ask({ t: 'save', name: name, mime: blob.type || '', data: data }, 0).then(function (answer) { saved(status, answer); });
            }
        }, function () {
            if (calendar)
                calendar(NO);
            else
                saved(status, NO);
        });
    }, true);
    function addCalendarButton(saveId, statusId) {
        var save = document.getElementById(saveId);
        var status = document.getElementById(statusId);
        if (!save || !status || document.getElementById(saveId + '-calendar'))
            return;
        var button = document.createElement('button');
        button.type = 'button';
        button.id = saveId + '-calendar';
        button.className = save.className.replace('btn-primary', 'btn-secondary');
        button.textContent = CALENDAR_LABEL;
        button.addEventListener('click', function () {
            if (save.disabled)
                return;
            calendarNext = function (answer) {
                tell(status, answer.ok === true ? CALENDAR_OPENED : CALENDAR_FAILED);
            };
            var mark = calendarNext;
            save.click();
            if (calendarNext === mark) {
                calendarNext = null;
                return;
            }
            tell(status, CALENDAR_OPENING);
        });
        save.insertAdjacentElement('afterend', button);
        var follow = function () { button.disabled = save.disabled; };
        follow();
        if (typeof MutationObserver === 'function')
            new MutationObserver(follow).observe(save, { attributes: true, attributeFilter: ['disabled'] });
    }
    whenParsed(function () {
        addCalendarButton('save-ics', 'ics-status');
        addCalendarButton('save-ics-ext', 'ext-status');
    });
    function printKind(text) {
        var fu = document.getElementById('fu-letter');
        var tl = document.getElementById('tl-text');
        if (fu && fu.value === text && fu.value !== (document.getElementById('letter') || {}).value)
            return 'follow-up';
        if (tl && tl.value === text && tl.value !== (document.getElementById('letter') || {}).value)
            return 'timeline';
        return 'letter';
    }
    function print() {
        window.dispatchEvent(new Event('beforeprint'));
        var box = document.getElementById('print-letter');
        var text = box ? box.textContent : '';
        window.dispatchEvent(new Event('afterprint'));
        if (!isText(text)) {
            if (text.length > MAX_TEXT)
                tell(lastStatus, TOO_LONG);
            return;
        }
        var status = lastStatus;
        tell(status, PRINT_SCREEN);
        ask({ t: 'print', text: text, kind: printKind(text) }).then(function (answer) {
            if (answer.ok !== true && status && status.textContent === PRINT_SCREEN)
                status.textContent = '';
        });
    }
    Object.defineProperty(window, 'print', { value: print, writable: false, configurable: false, enumerable: false });
    var OUTPUT_BOXES = ['letter', 'fu-letter', 'tl-text'];
    function typedSomething() {
        var fields = document.querySelectorAll('main input[type="text"], main input[type="email"], main textarea');
        for (var i = 0; i < fields.length; i++) {
            if (OUTPUT_BOXES.indexOf(fields[i].id) < 0 && fields[i].value.trim() !== '')
                return true;
        }
        var edited = ['letter-edited', 'fu-edited', 'tl-edited'];
        for (var j = 0; j < edited.length; j++) {
            var note = document.getElementById(edited[j]);
            if (note && !note.hidden)
                return true;
        }
        return false;
    }
    function canAsk(dialog) {
        return !!(dialog && document.getElementById('confirm-text') && document.getElementById('confirm-ok')
            && document.getElementById('confirm-cancel') && typeof dialog.showModal === 'function');
    }
    function askBeforeClosing(dialog, q) {
        var text = document.getElementById('confirm-text');
        var ok = document.getElementById('confirm-ok');
        var cancel = document.getElementById('confirm-cancel');
        if (!canAsk(dialog) || dialog.open)
            return false;
        var before = document.activeElement;
        text.textContent = CLOSE_QUESTION;
        ok.textContent = CLOSE_LABEL;
        var done = function (close) {
            ok.removeEventListener('click', yes);
            cancel.removeEventListener('click', no);
            dialog.removeEventListener('cancel', no);
            if (dialog.open)
                dialog.close();
            if (close)
                answerBack('close', q);
            else if (before && typeof before.focus === 'function' && before !== document.body)
                before.focus();
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
    var askingFor = 0;
    function onBack(q) {
        askingFor = 0;
        var dialog = document.getElementById('confirm-dialog');
        if (dialog && dialog.open) {
            var cancel = document.getElementById('confirm-cancel');
            if (cancel)
                cancel.click();
            else
                dialog.close();
            answerBack('stay', q);
            return;
        }
        if (canAsk(dialog) && typedSomething()) {
            askingFor = q;
            answerBack('ask', q);
            return;
        }
        answerBack('close', q);
    }
    function onAskOk(q) {
        if (q !== askingFor)
            return;
        askingFor = 0;
        var dialog = document.getElementById('confirm-dialog');
        if (dialog && dialog.open)
            return;
        if (!askBeforeClosing(dialog, q))
            answerBack('close', q);
    }
    var isQuery = function (q) { return typeof q === 'number' && q > 0 && q <= 0x7fffffff && Math.floor(q) === q; };
    bridge.addEventListener('message', function (ev) {
        var msg;
        try {
            msg = JSON.parse(ev.data);
        }
        catch (e) {
            return;
        }
        if (!msg || typeof msg !== 'object')
            return;
        if (msg.t === 'back') {
            if (isQuery(msg.q))
                onBack(msg.q);
            return;
        }
        if (msg.t === 'ask-ok') {
            if (isQuery(msg.q))
                onAskOk(msg.q);
            return;
        }
        if (msg.t === 'no-email-app') {
            if (emailStatus)
                emailStatus.textContent = '';
            return;
        }
        if (msg.t !== 'reply')
            return;
        var settle = waiting.get(msg.id);
        if (!settle)
            return;
        waiting.delete(msg.id);
        settle({ ok: msg.ok === true, cancelled: msg.cancelled === true, busy: msg.busy === true });
    });
    ask({ t: 'hello' });
})();
