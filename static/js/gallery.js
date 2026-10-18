/* LOOM — 갤러리: 생성 결과 보기 · 대기열 관리 */
(function () {
    'use strict';
    var PB = window.PB, esc = PB.esc, icon = PB.icon;
    PB.jobsLimit = 5000;

    function $(s, r) { return (r || document).querySelector(s); }
    function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

    var filter = 'all', query = '', jobs = [], items = [], selecting = false, selected = {};
    var lastSig = '';
    // 미리보기 크기: 기본(보통) 칸 너비에 대한 % — 최소·최대는 여기서 정한다
    var SIZE_MIN = 50, SIZE_MAX = 250, SIZE_STEP = 10, SIZE_BASE_COL = 190;
    var sizePct = 100;
    try {
        var savedZoom = localStorage.getItem('pb.gal.sizePct');
        if (savedZoom === null) savedZoom = {s: 70, m: 100, l: 150}[localStorage.getItem('pb.gal.size')];  // 예전 작게 · 보통 · 크게
        sizePct = clampSize(savedZoom || 100);
    } catch (e) {}
    function clampSize(v) {
        v = Math.round((parseInt(v, 10) || 100) / SIZE_STEP) * SIZE_STEP;
        return Math.min(SIZE_MAX, Math.max(SIZE_MIN, v));
    }

    function durationOf(j) {
        var a = PB.parseTime(j.started_at), b = PB.parseTime(j.completed_at || j.failed_at);
        return a && b ? PB.duration((b - a) / 1000) : '';
    }
    function matches(j) {
        if (!query) return true;
        var hay = (j.positive_prompt + ' ' + j.negative_prompt + ' ' + j.template_label + ' ' + j.workflow_name + ' ' + j.style_label).toLowerCase();
        return hay.indexOf(query) !== -1;
    }

    /* ---------- 대기열 ---------- */
    var activeSig = null;
    function renderActive() {
        var running = jobs.filter(function (j) { return j.status === 'running'; });
        var queued = jobs.filter(function (j) { return j.status === 'queued'; }).sort(function (a, b) { return a.id - b.id; });
        // 작업이 그대로면 다시 그리지 않는다 (상태를 갱신할 때마다 누르려던 취소 버튼이 바뀌지 않게)
        var sig = running.concat(queued).map(function (j) { return j.id + j.status; }).join(',');
        if (sig === activeSig) return;
        activeSig = sig;
        var box = $('#galActive');
        if (!running.length && !queued.length) { box.innerHTML = ''; box.hidden = true; return; }
        box.hidden = false;
        var html = running.map(function (j) {
            var since = PB.parseTime(j.started_at);
            return '<div class="q-card is-running"><span class="spinner"></span><div class="q-main"><b>' + esc(j.template_label || '프롬프트 생성') + '</b><span>' + esc(j.workflow_name) + ' · ' + esc(j.comfyui_url.replace(/^https?:\/\//, '')) + '</span></div>' +
                '<span class="q-time" data-since="' + since + '">' + PB.duration((PB.serverNow() - since) / 1000) + '</span>' +
                '<button type="button" class="btn btn-sm" data-cancel="' + j.id + '" data-running="1">' + icon('stop') + '중단</button></div>';
        }).join('');
        if (queued.length) {
            html += '<div class="q-card is-queued"><div class="q-head"><b>대기 중</b>' +
                '<button type="button" class="btn btn-sm btn-ghost" data-cancel-all>' + icon('x') + '대기 모두 취소</button></div>' +
                '<div class="q-list">' + queued.map(function (j, i) {
                    return '<div class="q-row"><span class="q-pos">' + (i + 1) + '</span>' +
                        '<b>' + esc(j.template_label || '프롬프트 생성') + '</b>' +
                        '<span class="q-meta">' + esc(j.workflow_name) + ' · ' + esc(j.comfyui_url.replace(/^https?:\/\//, '')) + '</span>' +
                        '<button type="button" class="btn btn-sm btn-ghost" data-cancel="' + j.id + '">' + icon('x') + '취소</button></div>';
                }).join('') + '</div></div>';
        }
        // 목록을 다시 그려도 대기 목록 스크롤 위치는 그대로
        var list = box.querySelector('.q-list'), top = list ? list.scrollTop : 0;
        box.innerHTML = html;
        list = box.querySelector('.q-list');
        if (list) list.scrollTop = top;
    }
    setInterval(function () {
        $$('#galActive [data-since]').forEach(function (el) { el.textContent = PB.duration((PB.serverNow() - parseInt(el.getAttribute('data-since'), 10)) / 1000); });
    }, 1000);
    $('#galActive').addEventListener('click', function (e) {
        var c = e.target.closest('[data-cancel]');
        if (c) {
            var go = function () { PB.api('/api/comfy/cancel', {job_id: parseInt(c.getAttribute('data-cancel'), 10)}).then(PB.setJobs); };
            if (c.hasAttribute('data-running')) PB.confirm('생성을 중단할까요?', '진행 중인 생성을 멈추고 다음 대기 작업을 시작합니다.', {confirmText: '중단'}).then(function (ok) { if (ok) go(); });
            else go();
        }
        if (e.target.closest('[data-cancel-all]')) {
            PB.confirm('대기 작업을 모두 취소할까요?', '진행 중인 생성도 함께 중단합니다.', {confirmText: '모두 취소'}).then(function (ok) {
                if (ok) PB.api('/api/comfy/cancel_all', {}).then(PB.setJobs);
            });
        }
    });

    /* ---------- 그리드 ---------- */
    function buildItems() {
        items = [];
        jobs.forEach(function (j) {
            if (!matches(j)) return;
            if (filter === 'failed') { if (j.status === 'failed') items.push({job: j, failed: true}); return; }
            if (j.status !== 'completed') return;
            (j.images || []).forEach(function (im, i) { items.push({job: j, url: im.url, thumb: im.thumb || im.url, file: im.file, n: i}); });
        });
    }
    function counts() {
        var all = 0, failed = 0;
        jobs.forEach(function (j) {
            if (j.status === 'completed') all += (j.images || []).length;
            if (j.status === 'failed') failed++;
        });
        $('#galCountAll').textContent = all || '';
        $('#galCountFailed').textContent = failed || '';
    }
    function renderGrid(force) {
        buildItems();
        var sig = filter + '|' + query + '|' + items.map(function (it) { return it.job.id + ':' + (it.n || 0); }).join(',');
        counts();
        if (!force && sig === lastSig) return;
        lastSig = sig;
        var grid = $('#galGrid');
        grid.className = 'gal-grid' + (selecting ? ' is-selecting' : '');
        applySize();
        if (!items.length) {
            grid.innerHTML = '';
            var empty = $('#galEmpty');
            empty.hidden = false;
            empty.innerHTML = filter === 'failed' ? icon('check') + '<b>실패한 작업이 없습니다</b>'
                : (query ? icon('search') + '<b>검색 결과가 없습니다</b>'
                    : icon('image') + '<b>아직 생성한 이미지가 없습니다</b><span>빌더에서 프롬프트를 만들고 ‘생성’을 누르면 여기에 모입니다.</span><a class="btn" href="/builder">' + icon('wand') + '빌더로</a>');
            return;
        }
        $('#galEmpty').hidden = true;
        var day = '';
        grid.innerHTML = items.map(function (it, idx) {
            var j = it.job;
            var d = String(j.completed_at || j.failed_at || j.created_at || '').slice(0, 10);
            var head = '';
            if (d !== day) { day = d; head = '<div class="gal-day">' + esc(dayLabel(d)) + '</div>'; }
            if (it.failed) {
                return head + '<div class="gal-fail" data-idx="' + idx + '"><div class="gal-fail-top">' + icon('alert') + '<b>' + esc(j.template_label || j.workflow_name || '생성 실패') + '</b><span class="faint">' + esc(String(j.failed_at || '').slice(11, 16)) + '</span></div>' +
                    '<p>' + esc(j.error_message || '알 수 없는 오류') + '</p><div class="gal-fail-actions">' +
                    '<button type="button" class="btn btn-sm" data-act="retry">' + icon('refresh') + '다시 시도</button>' +
                    '<a class="btn btn-sm btn-ghost" href="/builder?from_job=' + j.id + '">' + icon('wand') + '빌더로</a>' +
                    '<button type="button" class="btn btn-sm btn-ghost btn-danger" data-act="delete">' + icon('trash') + '</button></div></div>';
            }
            var sel = selected[j.id] ? ' is-selected' : '';
            return head + '<div class="gal-item' + sel + '" data-idx="' + idx + '">' +
                '<img src="' + esc(it.thumb) + '" alt="" loading="lazy" decoding="async">' +
                '<span class="gal-check">' + icon('check') + '</span>' +
                '<div class="gal-over"><div class="gal-cap"><b>' + esc(j.template_label || '프롬프트') + '</b><span>' + esc(j.workflow_name) + (durationOf(j) ? ' · ' + durationOf(j) : '') + '</span></div>' +
                '<div class="gal-acts"><button type="button" class="icon-btn sm" data-act="regen" title="같은 설정으로 다시 생성">' + icon('refresh') + '</button>' +
                '<a class="icon-btn sm" href="/builder?from_job=' + j.id + '" title="빌더에서 열기">' + icon('wand') + '</a>' +
                '<button type="button" class="icon-btn sm" data-act="delete" title="삭제">' + icon('trash') + '</button></div></div></div>';
        }).join('');
    }
    function dayLabel(d) {
        if (!d) return '';
        var today = new Date(PB.serverNow());
        var pad = function (n) { return (n < 10 ? '0' : '') + n; };
        var t = today.getFullYear() + '-' + pad(today.getMonth() + 1) + '-' + pad(today.getDate());
        var y = new Date(today.getTime() - 86400000);
        var ys = y.getFullYear() + '-' + pad(y.getMonth() + 1) + '-' + pad(y.getDate());
        if (d === t) return '오늘';
        if (d === ys) return '어제';
        return d.replace(/-/g, '.');
    }

    function deleteJobs(ids, askText) {
        return PB.confirm(askText || '이미지를 삭제할까요?', '목록과 함께 이미지 파일도 지워집니다. 되돌릴 수 없습니다.', {confirmText: '삭제', danger: true}).then(function (ok) {
            if (!ok) return false;
            return PB.api('/api/comfy/delete', {ids: ids}).then(function (d) { PB.setJobs(d); return true; });
        });
    }
    function regen(job, count) {
        PB.api('/api/comfy/regenerate', {job_id: job.id, count: count || 1}).then(function (d) {
            if (d && d.ok) { PB.toast((count || 1) + '장 다시 생성합니다.'); PB.setJobs(d); }
            else PB.toast((d && d.message) || '다시 생성하지 못했습니다.', 'error');
        });
    }

    $('#galGrid').addEventListener('click', function (e) {
        var card = e.target.closest('[data-idx]');
        if (!card) return;
        var it = items[parseInt(card.getAttribute('data-idx'), 10)];
        if (!it) return;
        var act = e.target.closest('[data-act]');
        if (act) {
            e.preventDefault();
            var a = act.getAttribute('data-act');
            if (a === 'regen' || a === 'retry') {
                regen(it.job, 1);
                if (a === 'retry') PB.api('/api/comfy/delete', {ids: [it.job.id]}).then(PB.setJobs);
            }
            if (a === 'delete') {
                if (it.failed) PB.api('/api/comfy/delete', {ids: [it.job.id]}).then(PB.setJobs);
                else deleteJobs([it.job.id]);
            }
            return;
        }
        if (e.target.closest('a')) return;
        if (it.failed) return;
        if (selecting) {
            if (selected[it.job.id]) delete selected[it.job.id]; else selected[it.job.id] = true;
            card.classList.toggle('is-selected', !!selected[it.job.id]);
            updateSelectBar();
            return;
        }
        openLightbox(parseInt(card.getAttribute('data-idx'), 10));
    });

    /* ---------- 선택 모드 ---------- */
    function setSelecting(on) {
        selecting = on;
        selected = {};
        $('#galSelectBar').hidden = !on;
        $('#galSelectBtn').classList.toggle('is-on', on);
        renderGrid(true);
        updateSelectBar();
    }
    function updateSelectBar() {
        var n = Object.keys(selected).length;
        $('#galSelCount').textContent = n + '개 선택';
        $('#galSelDelete').disabled = !n;
    }
    $('#galSelectBtn').addEventListener('click', function () { setSelecting(!selecting); });
    $('#galSelDone').addEventListener('click', function () { setSelecting(false); });
    $('#galSelAll').addEventListener('click', function () {
        items.forEach(function (it) { if (!it.failed) selected[it.job.id] = true; });
        renderGrid(true);
        updateSelectBar();
    });
    $('#galSelDelete').addEventListener('click', function () {
        var ids = Object.keys(selected).map(Number);
        deleteJobs(ids, ids.length + '개 작업의 이미지를 삭제할까요?').then(function (ok) { if (ok) setSelecting(false); });
    });

    /* ---------- 필터 · 크기 ---------- */
    $('#galFilter').addEventListener('click', function (e) {
        var b = e.target.closest('[data-f]');
        if (!b) return;
        filter = b.getAttribute('data-f');
        $$('#galFilter button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        renderGrid(true);
    });
    $('#galSearch').addEventListener('input', PB.debounce(function () { query = $('#galSearch').value.trim().toLowerCase(); renderGrid(true); }, 150));
    // 크기는 다시 그리지 않고 칸 너비만 바꾼다 (끌면서 바로 보이게)
    function applySize() {
        $('#galGrid').style.setProperty('--gal-col', Math.round(SIZE_BASE_COL * sizePct / 100) + 'px');
        var range = $('#galZoom'), out = $('#galZoomVal');
        if (range && +range.value !== sizePct) range.value = sizePct;
        if (out) out.textContent = sizePct + '%';
    }
    function setSize(v) {
        sizePct = clampSize(v);
        applySize();
        try { localStorage.setItem('pb.gal.sizePct', String(sizePct)); } catch (err) {}
    }
    (function () {
        var range = $('#galZoom');
        range.min = SIZE_MIN; range.max = SIZE_MAX; range.step = SIZE_STEP;
        range.addEventListener('input', function () { setSize(range.value); });
        $('#galZoomOut').addEventListener('click', function () { setSize(sizePct - SIZE_STEP); });
        $('#galZoomIn').addEventListener('click', function () { setSize(sizePct + SIZE_STEP); });
        $('#galZoomVal').addEventListener('click', function () { setSize(100); });
        applySize();
    })();
    $('#galOpenFolder').addEventListener('click', function () { PB.api('/api/data/open', {which: 'outputs'}); });

    /* ---------- 라이트박스 ---------- */
    var lb = null, lbIndex = -1, lbResize = null;
    var stripGridSig = null, stripSig = '', stripAt = '';
    var showStrip = true;
    try { showStrip = localStorage.getItem('pb.gal.strip') !== '0'; } catch (e) {}
    function openLightbox(idx) {
        var visible = items.filter(function (it) { return !it.failed; });
        if (!visible.length) return;
        lbIndex = idx;
        if (!lb) {
            lb = document.createElement('div');
            lb.className = 'lightbox';
            lb.innerHTML = '<div class="lightbox-main"><div class="lightbox-stage">' +
                '<button type="button" class="lightbox-nav prev" data-lb="prev">' + icon('chevron-left') + '</button>' +
                '<img alt="">' +
                '<button type="button" class="lightbox-nav next" data-lb="next">' + icon('chevron-right') + '</button>' +
                '<div class="lb-zoom" hidden>' +
                '<button type="button" data-lb="zoom-out" title="축소 (−)">' + icon('minus') + '</button>' +
                '<span class="lb-zoom-pct"></span>' +
                '<button type="button" data-lb="zoom-in" title="확대 (+)">' + icon('plus') + '</button>' +
                '<span class="lb-zoom-sep"></span>' +
                '<button type="button" data-lb="zoom-fit" title="화면에 맞춤 (0)">맞춤</button>' +
                '<button type="button" data-lb="zoom-1" title="실제 크기 100% (1)">실제 크기</button>' +
                '<span class="lb-zoom-sep"></span>' +
                '<span class="lb-zoom-dim" title="이미지 실제 크기 (픽셀)"></span></div></div>' +
                '<div class="lb-strip"></div></div>' +
                '<aside class="lightbox-side"></aside>';
            document.body.appendChild(lb);
            document.addEventListener('keydown', onLbKey, true);
            lb.addEventListener('click', onLbClick);
            lb.addEventListener('wheel', onLbWheel, {passive: false});
            var st = lb.querySelector('.lightbox-stage');
            st.addEventListener('mousedown', onPanDown);
            st.addEventListener('dblclick', onLbDblClick);
            st.addEventListener('dragstart', function (e) { if (zoom) e.preventDefault(); });  // 확대 중에는 끌기 = 옮기기
            st.querySelector('img').addEventListener('load', renderZoomBar);
            st.querySelector('img').addEventListener('error', renderZoomBar);
            // 창 크기 · 썸네일 줄이 바뀌면 맞춤 배율과 확대 위치를 다시 잡는다
            if (window.ResizeObserver) { lbResize = new ResizeObserver(applyZoom); lbResize.observe(st); }
        }
        renderStrip();
        renderLightbox();
    }
    function closeLightbox() {
        if (!lb) return;
        document.removeEventListener('keydown', onLbKey, true);
        onPanUp();
        if (lbResize) { lbResize.disconnect(); lbResize = null; }
        lb.remove();
        lb = null;
        lbIndex = -1;
        zoom = null;
        stripGridSig = null;
        stripSig = stripAt = '';
        if (location.hash) history.replaceState(null, '', '/gallery');
    }
    /* 아래쪽 썸네일 줄: 목록이 바뀔 때만 다시 그린다 */
    function renderStrip() {
        lb.classList.toggle('has-strip', showStrip);
        if (!showStrip || stripGridSig === lastSig) return;
        stripGridSig = lastSig;
        var sig = items.map(function (it) { return it.failed ? '' : it.url; }).join('|');
        if (sig === stripSig) return;
        stripSig = sig;
        stripAt = '';
        lb.querySelector('.lb-strip').innerHTML = items.map(function (it, idx) {
            if (it.failed) return '';
            return '<button type="button" class="lb-thumb" data-lb="thumb" data-i="' + idx + '"><img src="' + esc(it.thumb) + '" alt="" loading="lazy" decoding="async"></button>';
        }).join('');
    }
    function markThumb() {
        var strip = lb.querySelector('.lb-strip');
        var cur = strip.querySelector('.lb-thumb.is-active');
        var t = strip.querySelector('[data-i="' + lbIndex + '"]');
        if (cur !== t) {
            if (cur) cur.classList.remove('is-active');
            if (t) t.classList.add('is-active');
        }
        // 같은 이미지면 스크롤을 건드리지 않는다 (상태 갱신 중에 직접 넘겨 보던 위치 유지)
        var url = items[lbIndex].url;
        if (!t || !showStrip || stripAt === url) return;
        var first = !stripAt;
        stripAt = url;
        strip.scrollTo({left: t.offsetLeft - (strip.clientWidth - t.offsetWidth) / 2, behavior: first ? 'auto' : 'smooth'});
    }
    function toggleStrip() {
        showStrip = !showStrip;
        try { localStorage.setItem('pb.gal.strip', showStrip ? '1' : '0'); } catch (e) {}
        stripAt = '';
        renderStrip();
        renderLightbox();
    }
    function step(d) { stepTo(lbIndex + d, d); }
    function stepTo(i, d) {  // i부터 d 방향으로 실패하지 않은 첫 이미지
        while (items[i] && items[i].failed) i += d;
        if (items[i] && i !== lbIndex) { lbIndex = i; renderLightbox(); }
    }
    function renderLightbox() {
        var it = items[lbIndex];
        if (!it) return closeLightbox();
        var j = it.job, ov = j.overrides || {}, g = ov.generation || {};
        var size = (g.width && g.height) ? g.width + '×' + g.height : '';
        var multi = (j.images || []).length > 1 ? ' (' + (it.n + 1) + '/' + j.images.length + ')' : '';
        // 같은 이미지면 그대로 둔다 (상태를 갱신할 때마다 깜빡이지 않게)
        var img = lb.querySelector('.lightbox-stage img');
        if (img.getAttribute('src') !== it.url) {
            img.setAttribute('src', it.url);
            zoom = null;  // 다른 이미지는 화면 맞춤부터
            applyZoom();
        }
        lb.querySelector('.lightbox-side').innerHTML =
            '<div class="lb-top"><div><div class="detail-title">' + esc(j.template_label || '프롬프트') + multi + '</div><div class="faint">' + esc(j.style_label || '') + '</div></div>' +
            '<div class="lb-top-btns"><button type="button" class="icon-btn' + (showStrip ? ' is-on' : '') + '" data-lb="strip" title="아래쪽 썸네일 ' + (showStrip ? '숨기기' : '보기') + ' (T)">' + icon('strip') + '</button>' +
            '<button type="button" class="icon-btn" data-lb="close" title="닫기 (Esc)">' + icon('x') + '</button></div></div>' +
            '<div class="lb-actions">' +
            '<a class="btn btn-sm" href="/builder?from_job=' + j.id + '">' + icon('wand') + '빌더에서 열기</a>' +
            '<button type="button" class="btn btn-sm" data-lb="regen">' + icon('refresh') + '다시 생성</button>' +
            '<button type="button" class="btn btn-sm" data-lb="reveal">' + icon('folder') + PB.esc(PB.fileManager) + '</button>' +
            '<a class="btn btn-sm" href="' + esc(it.url) + '" download>' + icon('download') + '저장</a>' +
            '<button type="button" class="btn btn-sm btn-danger" data-lb="delete">' + icon('trash') + '삭제</button></div>' +
            '<dl class="kv">' +
            '<dt>workflow</dt><dd>' + esc(j.workflow_name || '-') + '</dd>' +
            (size ? '<dt>크기</dt><dd>' + esc(size) + '</dd>' : '') +
            (g.steps != null ? '<dt>steps · cfg</dt><dd>' + esc(g.steps) + ' · ' + esc(g.cfg != null ? g.cfg : '-') + '</dd>' : '') +
            (j.seed ? '<dt>seed</dt><dd>' + esc(j.seed) + '</dd>' : '') +
            '<dt>서버</dt><dd>' + esc(j.comfyui_url) + '</dd>' +
            '<dt>완료</dt><dd>' + esc(j.completed_at || '') + (durationOf(j) ? ' · ' + durationOf(j) : '') + '</dd>' +
            '<dt>파일</dt><dd>' + esc(it.file || '') + '</dd></dl>' +
            '<div class="prompt-label">Positive<button type="button" class="btn btn-sm" data-lb="copy-pos">' + icon('copy') + '복사</button></div>' +
            '<div class="prompt-box">' + esc(j.positive_prompt) + '</div>' +
            (j.negative_prompt ? '<div class="prompt-label">Negative<button type="button" class="btn btn-sm" data-lb="copy-neg">' + icon('copy') + '복사</button></div><div class="prompt-box">' + esc(j.negative_prompt) + '</div>' : '') +
            '<div class="faint lb-hint">← → 이동 · 휠 확대 · 축소 · 끌어서 옮기기 · 0 맞춤 · 1 실제 크기 · T 썸네일 · Esc 닫기</div>';
        var prev = lb.querySelector('[data-lb="prev"]'), next = lb.querySelector('[data-lb="next"]');
        prev.disabled = !items.slice(0, lbIndex).some(function (x) { return !x.failed; });
        next.disabled = !items.slice(lbIndex + 1).some(function (x) { return !x.failed; });
        markThumb();
    }
    function onLbKey(e) {
        if (e.target.matches && e.target.matches('input, textarea')) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeLightbox(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
        else if (e.key === 'Home') { e.preventDefault(); stepTo(0, 1); }
        else if (e.key === 'End') { e.preventDefault(); stepTo(items.length - 1, -1); }
        else if (e.metaKey || e.ctrlKey || e.altKey) return;  // ⌘T · ⌘+ 등 앱 단축키는 그대로
        else if (e.key === 't' || e.key === 'T') toggleStrip();
        else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(ZOOM_STEP); }
        else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / ZOOM_STEP); }
        else if (e.key === '0') { e.preventDefault(); zoomFit(); }
        else if (e.key === '1') { e.preventDefault(); setZoom(1); }
    }

    /* ---------- 확대 · 축소 ----------
       zoom = null 이면 화면 맞춤(CSS가 배치), 아니면 {s: 원본 대비 배율, x, y: 스테이지 안 이미지 왼쪽 위} */
    var zoom = null, pan = null, panMoved = false, zoomHoldUntil = 0, zoomHoldOut = false;
    var ZOOM_MIN = 0.1, ZOOM_MAX = 8, ZOOM_STEP = 1.25;
    function stageImg() { return lb ? lb.querySelector('.lightbox-stage img') : null; }
    function fitScale(img) {
        // CSS 맞춤과 같은 계산: 위 24 · 아래 48(배율 표시줄) · 양옆 70 여백 안에 들어가게, 원본보다 키우지는 않는다
        var st = img.parentNode;
        return Math.min(1, (st.clientWidth - 140) / img.naturalWidth, (st.clientHeight - 72) / img.naturalHeight);
    }
    function applyZoom() {
        var img = stageImg();
        if (!img) return;
        var st = img.parentNode;
        st.classList.toggle('is-zoomed', !!zoom);
        if (zoom && img.naturalWidth) {
            var w = img.naturalWidth * zoom.s, h = img.naturalHeight * zoom.s, W = st.clientWidth, H = st.clientHeight;
            // 화면보다 작은 쪽은 맞춤 때와 같은 가운데(세로는 표시줄 몫만큼 위로), 큰 쪽은 가장자리가 안으로 들어오지 않게
            zoom.x = w <= W ? (W - w) / 2 : Math.min(0, Math.max(W - w, zoom.x));
            zoom.y = h <= H ? Math.max(0, Math.min(H - h, (H - 24 - h) / 2)) : Math.min(0, Math.max(H - h, zoom.y));
            img.style.width = w + 'px';
            img.style.height = h + 'px';
            img.style.transform = 'translate(' + Math.round(zoom.x) + 'px,' + Math.round(zoom.y) + 'px)';
        } else {
            img.style.width = img.style.height = img.style.transform = '';
        }
        renderZoomBar();
    }
    function renderZoomBar() {
        var img = stageImg();
        if (!img) return;
        var bar = lb.querySelector('.lb-zoom');
        bar.hidden = !img.naturalWidth;
        if (bar.hidden) return;
        var fit = fitScale(img), s = zoom ? zoom.s : fit;
        bar.querySelector('.lb-zoom-pct').textContent = (s < 0.1 ? (s * 100).toFixed(1) : Math.round(s * 100)) + '%';
        bar.querySelector('.lb-zoom-dim').textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px';
        bar.querySelector('[data-lb="zoom-fit"]').classList.toggle('is-on', !zoom);
        bar.querySelector('[data-lb="zoom-1"]').classList.toggle('is-on', Math.abs(s - 1) < 1e-3);
        bar.querySelector('[data-lb="zoom-out"]').disabled = s <= Math.min(ZOOM_MIN, fit) + 1e-6;
        bar.querySelector('[data-lb="zoom-in"]').disabled = s >= ZOOM_MAX - 1e-6;
    }
    /* s배로 바꾸되 스테이지 안 (cx, cy) 점은 그 자리에 둔다 (없으면 가운데) */
    function setZoom(s, cx, cy) {
        var img = stageImg();
        if (!img || !img.naturalWidth) return;
        var st = img.parentNode, W = st.clientWidth, H = st.clientHeight, fit = fitScale(img);
        var cur = zoom;
        if (!cur) {  // 맞춤에서 시작: CSS가 놓은 자리 그대로
            var ir = img.getBoundingClientRect(), sr = st.getBoundingClientRect();
            cur = {s: ir.width / img.naturalWidth || fit, x: ir.left - sr.left, y: ir.top - sr.top};
        }
        s = Math.max(Math.min(ZOOM_MIN, fit), Math.min(ZOOM_MAX, s));
        if (cx == null) { cx = W / 2; cy = H / 2; }
        var k = s / cur.s;
        zoom = Math.abs(s - fit) < 1e-3 ? null : {s: s, x: cx - (cx - cur.x) * k, y: cy - (cy - cur.y) * k};
        applyZoom();
    }
    function zoomFit() { zoom = null; applyZoom(); }
    function zoomBy(f, cx, cy) {
        var img = stageImg();
        if (!img || !img.naturalWidth) return;
        var fit = fitScale(img), s = zoom ? zoom.s : fit, t = s * f, now = Date.now(), out = f < 1;
        // 맞춤 크기를 지나치면 한 번 멈춘다. 같은 쪽으로 이어지는 휠 · 키 반복은 손을 뗐다 다시 할 때까지 무시
        if (now < zoomHoldUntil && out === zoomHoldOut) { zoomHoldUntil = now + 200; return; }
        zoomHoldUntil = 0;
        var eps = 1e-3;
        if (s > fit + eps ? t < fit + eps : s < fit - eps && t > fit - eps) { t = fit; zoomHoldUntil = now + 200; zoomHoldOut = out; }
        setZoom(t, cx, cy);
    }
    /* 휠: 이미지 쪽에서는 커서 자리를 기준으로 확대 · 축소 (트랙패드 핀치도). 썸네일 줄은 키보드 ← →로 넘긴다 */
    var wheelLast = 0;
    function onLbWheel(e) {
        var st = e.target.closest('.lightbox-stage');
        if (!st) return;
        e.preventDefault();
        var d = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
        var now = Date.now(), gap = now - wheelLast;
        wheelLast = now;
        if (!d) return;
        var f;
        if (e.ctrlKey) f = Math.exp(-d * 0.01);  // 트랙패드 핀치
        else {
            // 휠 한 칸(40px 이상, 또는 따로 떨어져 온 이벤트 — Mac 마우스는 천천히 굴리면 4px쯤만 온다)은 한 단계,
            // 촘촘히 이어지는 작은 값(트랙패드 두 손가락)은 그만큼만
            var ticks = gap > 80 ? 1 : Math.min(1, Math.abs(d) / 40);
            f = Math.pow(ZOOM_STEP, d > 0 ? -ticks : ticks);
        }
        var r = st.getBoundingClientRect();
        zoomBy(f, e.clientX - r.left, e.clientY - r.top);
    }
    function onLbDblClick(e) {
        if (e.target.tagName !== 'IMG') return;
        var img = e.target, r = img.parentNode.getBoundingClientRect();
        if (zoom) zoomFit();
        else setZoom(fitScale(img) < 1 ? 1 : 2, e.clientX - r.left, e.clientY - r.top);
    }
    /* 확대했을 때 끌어서 옮기기 */
    function onPanDown(e) {
        if (!zoom || e.button !== 0 || e.target.closest('button, .lb-zoom')) return;
        e.preventDefault();
        pan = {x: e.clientX, y: e.clientY, zx: zoom.x, zy: zoom.y, moved: false};
        lb.querySelector('.lightbox-stage').classList.add('is-panning');
        window.addEventListener('mousemove', onPanMove);
        window.addEventListener('mouseup', onPanUp);
    }
    function onPanMove(e) {
        if (!pan || !zoom) return;
        var dx = e.clientX - pan.x, dy = e.clientY - pan.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
        zoom.x = pan.zx + dx;
        zoom.y = pan.zy + dy;
        applyZoom();
    }
    function onPanUp() {
        window.removeEventListener('mousemove', onPanMove);
        window.removeEventListener('mouseup', onPanUp);
        if (!pan) return;
        // 끌고 난 뒤 따라오는 click은 무시 (빈 곳에서 놓아도 닫히지 않게)
        panMoved = pan.moved;
        pan = null;
        if (panMoved) setTimeout(function () { panMoved = false; }, 0);
        if (lb) lb.querySelector('.lightbox-stage').classList.remove('is-panning');
    }

    function onLbClick(e) {
        if (panMoved) return;
        var b = e.target.closest('[data-lb]');
        // 빈 곳을 누르면 닫는다 (확대 중에는 실수로 닫히지 않게 그대로)
        if (!b) { if (e.target.classList.contains('lightbox-stage') && !zoom) closeLightbox(); return; }
        var it = items[lbIndex];
        var a = b.getAttribute('data-lb');
        if (a === 'close') closeLightbox();
        else if (a === 'prev') step(-1);
        else if (a === 'next') step(1);
        else if (a === 'thumb') { lbIndex = parseInt(b.getAttribute('data-i'), 10); renderLightbox(); }
        else if (a === 'strip') toggleStrip();
        else if (a === 'zoom-in') zoomBy(ZOOM_STEP);
        else if (a === 'zoom-out') zoomBy(1 / ZOOM_STEP);
        else if (a === 'zoom-fit') zoomFit();
        else if (a === 'zoom-1') setZoom(1);
        else if (a === 'regen') regen(it.job, 1);
        else if (a === 'reveal') PB.api('/api/comfy/reveal', {file: it.file});
        else if (a === 'copy-pos') PB.copy(it.job.positive_prompt).then(function () { PB.toast('Positive 프롬프트를 복사했습니다.'); });
        else if (a === 'copy-neg') PB.copy(it.job.negative_prompt).then(function () { PB.toast('Negative 프롬프트를 복사했습니다.'); });
        else if (a === 'delete') {
            var id = it.job.id;
            deleteJobs([id]).then(function (ok) {
                if (!ok) return;
                if (!items.some(function (x) { return !x.failed; })) closeLightbox();
                else { if (lbIndex >= items.length) lbIndex = items.length - 1; while (items[lbIndex] && items[lbIndex].failed) lbIndex--; renderLightbox(); }
            });
        }
    }

    /* ---------- 데이터 ---------- */
    var openedHash = false;
    window.addEventListener('pb:jobs', function (e) {
        jobs = (e.detail && e.detail.jobs) || [];
        renderActive();
        renderGrid(false);
        if (lb && lbIndex >= 0) {
            renderStrip();
            // 바뀐 정보 반영 (같은 이미지 유지)
            var cur = lb.querySelector('.lightbox-stage img');
            var src = cur ? cur.getAttribute('src') : '';
            var i = items.findIndex(function (x) { return x.url === src; });
            if (i >= 0) { lbIndex = i; renderLightbox(); }
        }
        if (!openedHash) {
            openedHash = true;
            var m = /^#job-(\d+)$/.exec(location.hash || '');
            if (m) {
                var idx = items.findIndex(function (x) { return String(x.job.id) === m[1] && !x.failed; });
                if (idx >= 0) openLightbox(idx);
            }
        }
    });
})();
