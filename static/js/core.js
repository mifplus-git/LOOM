/* LOOM — 공용 도구: API, 알림, 대화상자, 복사, 작업 상태 폴링 */
(function () {
    'use strict';
    var PB = window.PB = window.PB || {};
    var ICONS = window.PB_ICONS || {};

    PB.icon = function (name, cls) {
        return '<svg' + (cls ? ' class="' + cls + '"' : '') + ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
    };

    PB.esc = function (value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
            return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch];
        });
    };

    // 단축키 표기: macOS는 ⌘, Windows는 Ctrl (동작은 두 키 모두 받는다. 여기서는 화면에 보일 글자만)
    PB.isMac = /Mac/i.test(navigator.platform || navigator.userAgent || '');
    PB.mod = PB.isMac ? '⌘' : 'Ctrl';
    PB.fileManager = PB.isMac ? 'Finder' : '파일 탐색기';
    // PB.kbd('mod', 'S') → <kbd>⌘</kbd><kbd>S</kbd> (Windows <kbd>Ctrl</kbd><kbd>S</kbd>)
    PB.kbd = function () {
        return Array.prototype.map.call(arguments, function (k) { return '<kbd>' + PB.esc(k === 'mod' ? PB.mod : k) + '</kbd>'; }).join('');
    };
    PB.helpKey = PB.isMac ? PB.kbd('mod', '?') : PB.kbd('F1');  // 메뉴의 사용법 (QKeySequence.HelpContents)

    PB.debounce = function (fn, ms) {
        var t = null;
        return function () {
            var args = arguments, self = this;
            clearTimeout(t);
            t = setTimeout(function () { fn.apply(self, args); }, ms);
        };
    };

    PB.api = function (url, data) {
        var opts = {cache: 'no-store', headers: {'Accept': 'application/json'}};
        if (data !== undefined) {
            opts.method = 'POST';
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(data);
        }
        return fetch(url, opts).then(function (res) {
            return res.json().catch(function () { return {ok: false, message: '응답을 해석할 수 없습니다. (HTTP ' + res.status + ')'}; });
        }).catch(function () {
            return {ok: false, message: '앱 서버에 연결할 수 없습니다.'};
        });
    };

    /* ---------- 토스트 ---------- */
    PB.toast = function (message, type) {
        var wrap = document.getElementById('toastWrap');
        if (!wrap) return;
        var el = document.createElement('div');
        el.className = 'toast' + (type ? ' is-' + type : '');
        var ic = type === 'error' ? 'alert' : (type === 'warn' ? 'info' : 'check');
        el.innerHTML = PB.icon(ic) + '<span>' + PB.esc(message) + '</span>';
        wrap.appendChild(el);
        setTimeout(function () {
            el.classList.add('is-leaving');
            setTimeout(function () { el.remove(); }, 220);
        }, type === 'error' ? 4200 : 2200);
    };

    /* ---------- 대화상자 ----------
       opts.html: 본문 아래에 넣을 내용, opts.onOpen(el): 연 뒤 한 번, opts.collect(el): 닫을 때 value로 돌려줄 값 */
    PB.dialog = function (opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var back = document.createElement('div');
            back.className = 'dialog-backdrop';
            var icon = opts.icon || 'question';
            var icName = {warning: 'alert', error: 'alert', success: 'check', info: 'info', question: 'info'}[icon] || 'info';
            var buttons = '';
            if (opts.cancel !== false) buttons += '<button type="button" class="btn btn-ghost" data-r="cancel">' + PB.esc(opts.cancelText || '취소') + '</button>';
            if (opts.deny) buttons += '<button type="button" class="btn" data-r="deny">' + PB.esc(opts.deny) + '</button>';
            buttons += '<button type="button" class="btn ' + (opts.danger ? 'btn-danger-solid' : 'btn-primary') + '" data-r="ok">' + PB.esc(opts.confirmText || '확인') + '</button>';
            var input = opts.input ? '<input class="input dialog-input" type="text" value="' + PB.esc(opts.value || '') + '" placeholder="' + PB.esc(opts.placeholder || '') + '">' : '';
            back.innerHTML = '<div class="dialog" role="dialog" aria-modal="true">' +
                '<div class="dialog-icon is-' + PB.esc(icon) + '">' + PB.icon(icName) + '</div>' +
                '<h3>' + PB.esc(opts.title || '') + '</h3>' +
                (opts.text ? '<p>' + PB.esc(opts.text) + '</p>' : '') + input + (opts.html || '') +
                '<div class="dialog-actions">' + buttons + '</div></div>';
            document.body.appendChild(back);
            var field = back.querySelector('.dialog-input');
            var okBtn = back.querySelector('[data-r="ok"]');
            if (opts.onOpen) opts.onOpen(back);
            setTimeout(function () { (field || okBtn).focus(); if (field) field.select(); }, 30);
            function done(r) {
                if (r === 'ok' && okBtn.disabled) return;
                var value = opts.collect ? opts.collect(back) : (field ? field.value : undefined);
                document.removeEventListener('keydown', onKey, true);
                back.remove();
                resolve({isConfirmed: r === 'ok', isDenied: r === 'deny', isDismissed: r === 'cancel', value: value});
            }
            function onKey(e) {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('cancel'); }
                if (e.key === 'Enter' && (field ? document.activeElement === field : true)) { e.preventDefault(); done('ok'); }
            }
            document.addEventListener('keydown', onKey, true);
            back.addEventListener('click', function (e) {
                var b = e.target.closest('[data-r]');
                if (b) done(b.getAttribute('data-r'));
                else if (e.target === back && opts.cancel !== false) done('cancel');
            });
        });
    };
    PB.confirm = function (title, text, opts) {
        return PB.dialog(Object.assign({title: title, text: text, icon: 'warning'}, opts || {})).then(function (r) { return r.isConfirmed; });
    };
    PB.alert = function (title, text, icon) {
        return PB.dialog({title: title, text: text, icon: icon || 'info', cancel: false});
    };
    PB.promptText = function (title, value, opts) {
        return PB.dialog(Object.assign({title: title, input: true, value: value || '', icon: 'info'}, opts || {})).then(function (r) {
            return r.isConfirmed ? String(r.value || '').trim() : null;
        });
    };

    /* ---------- 복사 ---------- */
    PB.copy = function (text) {
        text = String(text || '');
        function fallback() {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            var ok = false;
            try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
            ta.remove();
            return ok;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
        }
        return Promise.resolve(fallback());
    };

    /* ---------- 시간 표시 ---------- */
    PB.parseTime = function (s) {
        if (!s) return 0;
        var t = new Date(String(s).replace(' ', 'T')).getTime();
        return Number.isFinite(t) ? t : 0;
    };
    PB.duration = function (sec) {
        sec = Math.max(0, Math.round(sec));
        if (sec < 60) return sec + '초';
        var m = Math.floor(sec / 60), s = sec % 60;
        return m + '분 ' + (s < 10 ? '0' : '') + s + '초';
    };

    /* ---------- 작업 상태 폴링 (사이드바 + 페이지 공용) ---------- */
    var lastStatus = null;
    var pollTimer = null;
    var serverOffset = 0;
    PB.jobs = function () { return lastStatus; };
    PB.serverNow = function () { return Date.now() + serverOffset; };
    function renderSidebar(data) {
        var counts = data.counts || {};
        var running = counts.running || 0, queued = counts.queued || 0;
        var active = running + queued;
        var badge = document.getElementById('navJobCount');
        if (badge) {
            badge.hidden = active === 0;
            badge.textContent = String(active);
            badge.classList.toggle('is-live', running > 0);
        }
        var servers = data.servers || [];
        var first = servers[0] || null;
        var dot = document.getElementById('sbDot');
        var label = document.getElementById('sbServer');
        var queue = document.getElementById('sbQueue');
        if (dot && label) {
            dot.className = 'status-dot';
            if (!first) {
                label.textContent = 'ComfyUI 서버 미설정';
            } else if (running > 0) {
                dot.classList.add('is-busy');
                label.textContent = '생성 중 · ' + first.url.replace(/^https?:\/\//, '');
            } else if (first.ok === true) {
                dot.classList.add('is-ok');
                label.textContent = 'ComfyUI 연결됨' + (first.ms != null ? ' · ' + first.ms + 'ms' : '');
            } else if (first.ok === false) {
                dot.classList.add('is-bad');
                label.textContent = 'ComfyUI 연결 안 됨';
            } else {
                label.textContent = 'ComfyUI 확인 중…';
            }
            label.title = first ? (first.url + (first.message ? '\n' + first.message : '')) : '';
        }
        if (queue) {
            queue.textContent = active ? ('생성 중 ' + running + ' · 대기 ' + queued) : '대기 작업 없음';
        }
    }
    PB.refreshJobs = function () {
        return PB.api('/api/comfy/status?limit=' + (PB.jobsLimit || 120)).then(function (data) {
            if (data && data.ok) {
                if (data.server_time) serverOffset = PB.parseTime(data.server_time) - Date.now();
                lastStatus = data;
                renderSidebar(data);
                window.dispatchEvent(new CustomEvent('pb:jobs', {detail: data}));
            }
            schedule();
            return data;
        });
    };
    function schedule() {
        clearTimeout(pollTimer);
        var counts = (lastStatus && lastStatus.counts) || {};
        var active = (counts.running || 0) + (counts.queued || 0);
        pollTimer = setTimeout(PB.refreshJobs, document.hidden ? 8000 : (active ? 1200 : 4000));
    }
    PB.setJobs = function (data) {
        if (!data || !data.ok) return;
        lastStatus = Object.assign({}, lastStatus || {}, data);
        renderSidebar(lastStatus);
        window.dispatchEvent(new CustomEvent('pb:jobs', {detail: lastStatus}));
        schedule();
    };
    document.addEventListener('visibilitychange', function () { if (!document.hidden) PB.refreshJobs(); });
    document.addEventListener('DOMContentLoaded', function () { PB.refreshJobs(); });

    /* ---------- 간단 이미지 보기 ---------- */
    PB.viewImage = function (src, caption) {
        var back = document.createElement('div');
        back.className = 'dialog-backdrop image-view';
        back.innerHTML = '<figure><img src="' + PB.esc(src) + '" alt=""><figcaption>' + PB.esc(caption || '') + '</figcaption></figure>';
        document.body.appendChild(back);
        function close() { document.removeEventListener('keydown', onKey, true); back.remove(); }
        function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
        document.addEventListener('keydown', onKey, true);
        back.addEventListener('click', close);
    };
})();
