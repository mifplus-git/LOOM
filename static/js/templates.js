/* LOOM — 템플릿 만들기 (목록 · 편집기) */
(function () {
    'use strict';
    var PB = window.PB, B = window.PB_BOOT || {}, esc = PB.esc, icon = PB.icon;
    function $(s, r) { return (r || document).querySelector(s); }
    function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

    if (B.mode === 'list') initList(); else initEditor();

    /* ================================================================ 목록 */
    function initList() {
        var list = B.templates || [];
        var styles = B.styles || [];
        var styleLabel = {};
        var f = {style: '', q: '', sort: 'name'};
        try { var saved = JSON.parse(localStorage.getItem('pb.tl.filter') || '{}'); f.style = saved.style || ''; f.q = saved.q || ''; f.sort = saved.sort || 'name'; } catch (e) {}

        function natural(a, b) { return String(a).localeCompare(String(b), 'ko', {numeric: true, sensitivity: 'base'}); }
        function setStyles(next) {
            styles = next || [];
            styleLabel = {};
            styles.forEach(function (s) { styleLabel[s.id] = s.label; });
            list.forEach(function (t) { t.style_label = styleLabel[t.style_id] || ''; });
        }
        function buildStyleSelect() {
            var counts = {};
            list.forEach(function (t) { counts[t.style_id] = (counts[t.style_id] || 0) + 1; });
            var opts = '<option value="">전체 스타일</option>' + styles.filter(function (s) { return counts[s.id]; }).sort(function (a, b) { return natural(a.label, b.label); }).map(function (s) {
                return '<option value="' + s.id + '">' + esc(s.label) + ' (' + counts[s.id] + ')</option>';
            }).join('');
            $('#tlStyle').innerHTML = opts;
            $('#tlStyle').value = f.style;
            if ($('#tlStyle').value !== String(f.style)) { f.style = ''; $('#tlStyle').value = ''; }
        }
        function render() {
            try { localStorage.setItem('pb.tl.filter', JSON.stringify(f)); } catch (e) {}
            var q = f.q.trim().toLowerCase();
            var rows = list.filter(function (t) {
                if (f.style && String(t.style_id) !== String(f.style)) return false;
                if (q && (t.title + ' ' + t.tags + ' ' + t.style_label).toLowerCase().indexOf(q) === -1) return false;
                return true;
            });
            rows.sort(f.sort === 'new' ? function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id; } : function (a, b) { return natural(a.title, b.title) || a.id - b.id; });
            $('#tlCount').textContent = rows.length === list.length ? list.length + '개' : rows.length + ' / ' + list.length + '개';
            $$('#tlSort button').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-s') === f.sort); });
            $('#tlEmpty').hidden = rows.length > 0;
            $('#tlEmpty').textContent = list.length ? '조건에 맞는 템플릿이 없습니다.' : '템플릿이 없습니다. ‘새 템플릿’으로 만들거나 데이터 메뉴에서 가져오세요.';
            $('#tlGrid').innerHTML = rows.map(function (t) {
                var styleOpts = '<option value="0">스타일 없음</option>' + styles.filter(function (s) { return s.label !== '기본' || s.id === t.style_id; }).map(function (s) {
                    return '<option value="' + s.id + '"' + (s.id === t.style_id ? ' selected' : '') + '>' + esc(s.label) + '</option>';
                }).join('');
                return '<article class="tl-card" data-id="' + t.id + '">' +
                    '<a class="tl-thumb" href="/templates/' + t.id + '">' + (t.new_day ? '<span class="pb-new-badge pb-new-badge--day' + t.new_day + '">NEW</span>' : '') +
                    (t.image ? '<img src="' + esc(t.image) + '" alt="" loading="lazy" decoding="async">' : '<span class="tcard-noimg">' + icon('image') + '</span>') +
                    '<span class="tl-hover"><span class="btn btn-sm">' + icon('pen') + '편집</span></span></a>' +
                    '<div class="tl-body"><a class="tl-title" href="/templates/' + t.id + '">' + esc(t.title || '이름 없음') + '</a>' +
                    '<div class="tl-meta">' + (t.tags ? '<span class="tl-tags">' + esc(t.tags) + '</span>' : '<span class="faint">' + esc(String(t.created_at || '').slice(0, 10)) + '</span>') + '</div>' +
                    '<div class="tl-actions">' +
                    '<select class="input tl-style" data-act="style" title="스타일 변경">' + styleOpts + '</select>' +
                    '<button type="button" class="icon-btn sm" data-act="dup" title="복제">' + icon('copy') + '</button>' +
                    '<button type="button" class="icon-btn sm" data-act="del" title="삭제">' + icon('trash') + '</button>' +
                    '</div></div></article>';
            }).join('');
        }
        function refreshStyles() {
            return PB.api('/api/styles').then(function (d) {
                if (!d || !d.ok) return;
                setStyles(d.items);
                buildStyleSelect(); render();
                renderStyleManager();
            });
        }

        /* 스타일 관리 (빌더의 스타일 목록) */
        var styleBox = null;
        function renderStyleManager() {
            if (!styleBox) return;
            var rows = styles.slice().sort(function (a, b) { return natural(a.label, b.label); }).map(function (s) {
                return '<div class="style-item" data-sid="' + s.id + '"><span class="style-name">' + esc(s.label) + '</span><span class="chip">' + s.total + '개</span>' +
                    '<button type="button" class="icon-btn sm" data-style-rename title="이름 바꾸기">' + icon('pen') + '</button>' +
                    '<button type="button" class="icon-btn sm" data-style-del title="' + (s.total ? '이 스타일을 쓰는 템플릿이 있어 삭제할 수 없습니다' : '삭제') + '"' + (s.total ? ' disabled' : '') + '>' + icon('trash') + '</button></div>';
            }).join('');
            $('.style-list', styleBox).innerHTML = rows || '<div class="pb-empty">스타일이 없습니다.</div>';
            $('.dialog-head .sub', styleBox).textContent = styles.length + '개';
        }
        function openStyleManager() {
            if (styleBox) return;
            styleBox = document.createElement('div');
            styleBox.className = 'dialog-backdrop';
            styleBox.innerHTML = '<div class="dialog dialog-wide style-manager" role="dialog" aria-modal="true"><div class="dialog-head"><h3>' + icon('palette') + '스타일 관리 <span class="sub"></span></h3>' +
                '<div class="actions"><button type="button" class="btn btn-sm" data-style-add>' + icon('plus') + '스타일 추가</button><button type="button" class="icon-btn" data-x title="닫기 (Esc)">' + icon('x') + '</button></div></div>' +
                '<p class="help" style="margin:0 0 12px">빌더의 스타일 목록입니다. 이름 앞 숫자로 순서를 정할 수 있어요 (예: 10. 풍경). 템플릿을 내보내면 스타일도 함께 담기고, 가져올 때 이름이 같은 스타일은 이미 있는 것을 씁니다.</p>' +
                '<div class="style-list"></div></div>';
            document.body.appendChild(styleBox);
            renderStyleManager();
            document.addEventListener('keydown', onStyleKey, true);
            styleBox.addEventListener('click', function (e) {
                var t = e.target;
                if (t === styleBox || t.closest('[data-x]')) return closeStyleManager();
                if (t.closest('[data-style-add]')) {
                    PB.promptText('새 스타일 이름', '', {placeholder: '예: 60. 판타지'}).then(function (name) {
                        if (name) PB.api('/api/styles/save', {id: 0, label: name}).then(function (d) { if (!d.ok) PB.toast(d.message, 'error'); refreshStyles(); });
                    });
                    return;
                }
                var row = t.closest('[data-sid]');
                if (!row) return;
                var sid = parseInt(row.getAttribute('data-sid'), 10);
                var st = styles.filter(function (x) { return x.id === sid; })[0];
                if (t.closest('[data-style-rename]')) {
                    PB.promptText('스타일 이름 바꾸기', st.label).then(function (name) {
                        if (name && name !== st.label) PB.api('/api/styles/save', {id: sid, label: name}).then(function (d) { if (!d.ok) PB.toast(d.message, 'error'); refreshStyles(); });
                    });
                } else if (t.closest('[data-style-del]')) {
                    PB.api('/api/styles/delete', {id: sid}).then(function (d) { if (!d.ok) PB.toast(d.message, 'error'); refreshStyles(); });
                }
            });
        }
        function onStyleKey(e) {
            // 이름 입력 대화상자가 떠 있으면 그쪽이 Esc를 받는다
            if (e.key === 'Escape' && styleBox && !document.querySelector('.dialog-input')) { e.preventDefault(); closeStyleManager(); }
        }
        function closeStyleManager() {
            document.removeEventListener('keydown', onStyleKey, true);
            if (styleBox) styleBox.remove();
            styleBox = null;
            if (location.hash === '#styles') history.replaceState(null, '', location.pathname);
        }

        function find(id) { return list.filter(function (t) { return t.id === id; })[0]; }
        $('#tlSort').addEventListener('click', function (e) { var b = e.target.closest('[data-s]'); if (!b) return; f.sort = b.getAttribute('data-s'); render(); });
        $('#tlStyle').addEventListener('change', function () { f.style = this.value; render(); });
        $('#tlStyles').addEventListener('click', openStyleManager);
        $('#tlSearch').value = f.q || '';
        $('#tlSearch').addEventListener('input', PB.debounce(function () { f.q = $('#tlSearch').value; render(); }, 120));
        $('#tlGrid').addEventListener('click', function (e) {
            var b = e.target.closest('[data-act]');
            if (!b || b.tagName === 'SELECT') return;
            var card = b.closest('[data-id]'), id = parseInt(card.getAttribute('data-id'), 10), t = find(id);
            var act = b.getAttribute('data-act');
            if (act === 'dup') {
                PB.api('/api/templates/' + id + '/duplicate', {}).then(function (d) {
                    if (!d.ok) return PB.toast(d.message, 'error');
                    location.href = '/templates/' + d.id;
                });
            } else if (act === 'del') {
                PB.confirm('‘' + t.title + '’ 템플릿을 삭제할까요?', '삭제하면 되돌릴 수 없습니다.', {confirmText: '삭제', danger: true}).then(function (ok) {
                    if (!ok) return;
                    PB.api('/api/templates/' + id + '/delete', {}).then(function (d) {
                        if (!d.ok) return PB.toast(d.message, 'error');
                        list = list.filter(function (x) { return x.id !== id; });
                        refreshStyles();
                        PB.toast('삭제했습니다.');
                    });
                });
            }
        });
        $('#tlGrid').addEventListener('change', function (e) {
            var sel = e.target.closest('[data-act="style"]');
            if (!sel) return;
            var id = parseInt(sel.closest('[data-id]').getAttribute('data-id'), 10), t = find(id);
            var prev = t.style_id;
            PB.api('/api/templates/' + id + '/style', {style_id: parseInt(sel.value, 10)}).then(function (d) {
                if (!d.ok) { sel.value = prev; return PB.toast(d.message, 'error'); }
                t.style_id = d.style_id;
                refreshStyles();  // 스타일 없음은 '기본' 스타일로 저장되고, 스타일별 개수도 바뀐다
                PB.toast('스타일을 바꿨습니다.');
            });
        });
        setStyles(styles);
        buildStyleSelect();
        render();
        if (location.hash === '#styles') openStyleManager();
    }

    /* ================================================================ 편집기 */
    function initEditor() {
        var T = B.template || {id: 0, title: '', style_id: 0, positive: '', negative: '', image: '', lora_ids: [], variables: [], tags: ''};
        var vars = {};               // 이름 → {label, options:[{name,prompt}]}
        (T.variables || []).forEach(function (v) { vars[v.name] = {label: v.label, options: v.options.length ? v.options : [{name: '1', prompt: ''}]}; });
        var model = {title: T.title, style_id: T.style_id || 0, positive: T.positive, negative: T.negative, tags: T.tags || '',
            lora: (T.lora_ids || []).slice(), thumbnail: '', image: T.image || '', removeThumb: false};
        var currentVar = '';
        var dirty = false;
        var tab = 'basic';

        function extractVars() {
            var names = [], re = /\{([a-zA-Z0-9_가-힣\-]+)\}/g, m;
            var text = model.positive + '\n' + model.negative;
            while ((m = re.exec(text)) !== null) if (names.indexOf(m[1]) === -1) names.push(m[1]);
            names.forEach(function (n) { if (!vars[n]) vars[n] = {label: n, options: [{name: '1', prompt: ''}]}; });
            return names;
        }
        function inlineCount() {
            var m = model.positive.match(/\{(?:[^{}:|]+:)?[^{}]*\|[^{}]*\}/g);
            return m ? m.length : 0;
        }
        function markDirty() { dirty = true; }

        function render() {
            var names = extractVars();
            $('#edVarCount').textContent = names.length || '';
            $$('#edTabs button').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-t') === tab); });
            if (tab === 'basic') renderBasic(names); else renderDetails(names);
        }

        function renderBasic(names) {
            var styleOpts = '<option value="0">스타일 선택</option>' + (B.styles || []).map(function (s) {
                return '<option value="' + s.id + '"' + (s.id === model.style_id ? ' selected' : '') + '>' + esc(s.label) + '</option>';
            }).join('') + '<option value="new">＋ 새 스타일…</option>';
            var thumb = model.thumbnail || (model.removeThumb ? '' : model.image);
            var loraList = (B.loras || []).map(function (l) {
                var on = model.lora.indexOf(l.id) !== -1;
                return '<button type="button" class="lora-row' + (on ? ' is-on' : '') + '" data-lora="' + l.id + '" data-search="' + esc((l.title + ' ' + l.support).toLowerCase()) + '"><span class="lora-check">' + icon('check') + '</span><span class="lora-title">' + esc(l.title) + '</span>' + (l.support ? '<span class="chip">' + esc(l.support) + '</span>' : '') + '</button>';
            }).join('');
            var inl = inlineCount();
            $('#editor').innerHTML =
                '<div class="ed-grid"><div class="ed-main">' +
                '<div class="card"><label class="field"><span>제목</span><input class="input input-lg" id="edTitle" type="text" value="' + esc(model.title) + '" placeholder="예: 부티크 쇼핑" autocomplete="off"></label></div>' +
                '<div class="card"><div class="card-title">' + icon('sparkles') + '<span>Positive Prompt</span><span class="sub">{변수}를 쓰면 빌더에서 고를 수 있는 세부 항목이 됩니다</span></div>' +
                '<textarea class="textarea mono ed-prompt" id="edPositive" spellcheck="false" placeholder="masterpiece, best quality, a woman wearing {outfit}, {pose}, in {background}">' + esc(model.positive) + '</textarea>' +
                '<div class="var-chips">' + chipsHtml(names) + '</div>' +
                '<p class="help" id="edInlineHelp"' + (inl ? '' : ' hidden') + '>' + icon('info') + ' 바로 고르기 패턴 ' + inl + '개({이름:A|B})는 저장할 때 세부 항목으로 바뀝니다.</p>' +
                '<div class="section-title">Negative Prompt</div>' +
                '<textarea class="textarea mono" id="edNegative" spellcheck="false" placeholder="lowres, bad anatomy, extra fingers">' + esc(model.negative) + '</textarea></div>' +
                '<div class="card"><div class="card-title">' + icon('list') + '<span>Full Options</span><span class="sub">세부 항목을 한 번에 입력</span>' +
                '<div class="actions"><button type="button" class="btn btn-sm" id="edImport">' + icon('upload') + '코드 불러오기</button><button type="button" class="btn btn-sm" id="edExport">' + icon('download') + '코드 저장</button></div></div>' +
                '<textarea class="textarea mono" id="edFull" spellcheck="false" placeholder="{outfit} 복장&#10;화사한 니트 | a bright colorful knit sweater&#10;컬러 티셔츠 | a vivid colored t-shirt&#10;{pose} 포즈&#10;서 있기 | standing&#10;앉기 | sitting"></textarea>' +
                '<div class="field-row" style="margin-top:8px"><p class="help" style="margin:0;flex:1">{변수명} 뒤에 이름을 쓰고, 다음 줄부터 <b>표시 이름 | prompt</b> 형식으로 적은 뒤 반영하세요.</p><button type="button" class="btn btn-sm btn-primary" id="edApplyFull">세부 항목에 반영</button></div></div>' +
                '</div><aside class="ed-side">' +
                '<div class="card"><div class="ed-thumb" id="edThumb">' + (thumb ? '<img src="' + esc(thumb) + '" alt="">' : '<div class="ed-thumb-empty">' + icon('image') + '<span>썸네일 이미지</span></div>') +
                '</div><div class="ed-thumb-actions"><button type="button" class="btn btn-sm" id="edPickFile">' + icon('upload') + '파일</button>' +
                '<button type="button" class="btn btn-sm" id="edPickGallery">' + icon('image') + '생성 이미지</button>' +
                (thumb ? '<button type="button" class="icon-btn sm" id="edThumbClear" title="썸네일 지우기">' + icon('trash') + '</button>' : '') + '</div>' +
                '<p class="help">정사각형 500×500으로 잘라 저장합니다. 이미지를 끌어다 놓아도 됩니다.</p>' +
                '<input type="file" id="edFile" accept="image/*" hidden></div>' +
                '<div class="card"><label class="field"><span>스타일</span><select class="input" id="edStyle">' + styleOpts + '</select></label>' +
                '<p class="help">빌더의 스타일 목록에서 이 스타일로 분류됩니다. 고르지 않으면 ‘기본’에 들어갑니다.</p>' +
                '<label class="field" style="margin-top:12px"><span>태그</span><input class="input" id="edTags" type="text" value="' + esc(model.tags) + '" placeholder="쉼표로 구분 (검색용)"></label></div>' +
                '<div class="card"><div class="card-title">' + icon('link') + '<span>LoRA</span><span class="chip accent" id="edLoraCount">' + (model.lora.length || '') + '</span></div>' +
                ((B.loras || []).length ? '<div class="search-wrap">' + icon('search') + '<input class="input" id="edLoraSearch" type="search" placeholder="LoRA 검색"></div><div class="lora-list" id="edLoraList">' + loraList + '</div>'
                    : '<p class="help" style="margin-top:0">등록된 LoRA가 없습니다.</p>') +
                '<details class="extra-box"><summary>' + icon('plus') + '새 LoRA 등록</summary><div class="new-lora">' +
                '<input class="input" data-nl="title" placeholder="제목"><input class="input" data-nl="filename" placeholder="파일명 (예: myLora.safetensors)">' +
                '<input class="input" data-nl="support_type" placeholder="지원 모델 (SDXL, Flux…)"><input class="input" data-nl="default_strength" placeholder="기본 강도 1.0">' +
                '<input class="input" data-nl="trigger_text" placeholder="트리거 단어"><p class="help">저장할 때 LoRA 목록에 추가되고 이 템플릿에 적용됩니다.</p></div></details></div>' +
                '</aside></div>';
            autoGrow($('#edPositive'));
        }

        function chipsHtml(names) {
            return names.map(function (n) {
                var v = vars[n];
                var filled = v.options.filter(function (o) { return o.prompt.trim(); }).length;
                return '<button type="button" class="var-chip' + (filled ? '' : ' is-empty') + '" data-goto-var="' + esc(n) + '">{' + esc(n) + '}<span>' + filled + '</span></button>';
            }).join('') || '<span class="faint">아직 {변수}가 없습니다. 예: {outfit} · 바로 고르기: {pose:서 있기|앉기}</span>';
        }
        var refreshChips = PB.debounce(function () {
            var names = extractVars();
            $('#edVarCount').textContent = names.length || '';
            var box = $('.var-chips');
            if (box) box.innerHTML = chipsHtml(names);
            var inl = inlineCount(), help = $('#edInlineHelp');
            if (help) { help.hidden = !inl; help.innerHTML = icon('info') + ' 바로 고르기 패턴 ' + inl + '개({이름:A|B})는 저장할 때 세부 항목으로 바뀝니다.'; }
        }, 200);

        function renderDetails(names) {
            if (!names.length) {
                $('#editor').innerHTML = '<div class="gal-empty">' + icon('list') + '<b>세부 항목이 없습니다</b><span>Positive Prompt에 {outfit} 같은 변수를 넣으면 여기서 고를 거리를 만들 수 있어요.</span><button type="button" class="btn" data-tab="basic">기본 정보로</button></div>';
                return;
            }
            if (names.indexOf(currentVar) === -1) currentVar = names[0];
            var side = names.map(function (n) {
                var v = vars[n], filled = v.options.filter(function (o) { return o.prompt.trim(); }).length;
                return '<button type="button" class="var-item' + (n === currentVar ? ' is-active' : '') + '" data-var="' + esc(n) + '"><span class="var-name">' + esc(v.label && v.label !== n ? v.label.replace(/_/g, ' ') : n) + '</span><span class="var-key">{' + esc(n) + '}</span><span class="var-n' + (filled ? '' : ' is-empty') + '">' + filled + '</span></button>';
            }).join('');
            var v = vars[currentVar];
            var rows = v.options.map(function (o, i) {
                return '<div class="opt-row" data-i="' + i + '"><span class="opt-n">' + (i + 1) + '</span><input class="input" data-o="name" value="' + esc(o.name) + '" placeholder="표시 이름">' +
                    '<input class="input mono" data-o="prompt" value="' + esc(o.prompt) + '" placeholder="prompt" spellcheck="false">' +
                    '<button type="button" class="icon-btn sm" data-o-up="' + i + '" title="위로"' + (i ? '' : ' disabled') + '>' + icon('chevron-left') + '</button>' +
                    '<button type="button" class="icon-btn sm" data-o-del="' + i + '" title="삭제">' + icon('x') + '</button></div>';
            }).join('');
            $('#editor').innerHTML = '<div class="det-grid"><aside class="card var-list">' + side + '</aside>' +
                '<div class="card"><div class="card-title">' + icon('list') + '<span>{' + esc(currentVar) + '}</span><span class="sub">빌더에서 첫 번째 항목이 기본으로 선택됩니다</span></div>' +
                '<label class="field"><span>세부 항목 이름</span><input class="input" id="varLabel" value="' + esc(v.label) + '" placeholder="빌더에 보이는 이름"></label>' +
                '<div class="section-title">옵션 <span class="faint">' + v.options.length + '개</span></div>' +
                '<div class="opt-list" id="optList">' + rows + '</div>' +
                '<div class="field-row" style="margin-top:8px"><button type="button" class="btn btn-sm" id="optAdd">' + icon('plus') + '옵션 추가</button><div class="spacer" style="flex:1"></div>' +
                '<button type="button" class="btn btn-sm btn-ghost" id="optClear">' + icon('trash') + '모두 지우기</button></div>' +
                '<details class="extra-box"><summary>' + icon('plus') + '일괄 입력</summary><textarea class="textarea mono" id="bulkText" spellcheck="false" placeholder="웃음 | smile, happy&#10;무표정 | neutral expression&#10;| cinematic lighting"></textarea>' +
                '<div class="field-row" style="margin-top:6px"><p class="help" style="margin:0;flex:1">줄마다 <b>표시 이름 | prompt</b>. 이름을 비우면 1, 2, 3…으로 저장됩니다.</p><button type="button" class="btn btn-sm" id="bulkAppend">뒤에 추가</button><button type="button" class="btn btn-sm btn-primary" id="bulkReplace">목록 바꾸기</button></div></details>' +
                '</div></div>';
        }

        function parseLines(text) {
            var rows = [];
            String(text || '').split(/\r?\n/).forEach(function (line) {
                var raw = line.trim();
                if (!raw) return;
                var i = raw.indexOf('|');
                var name = i >= 0 ? raw.slice(0, i).trim() : '';
                var prompt = i >= 0 ? raw.slice(i + 1).trim() : raw;
                rows.push({name: name || String(rows.length + 1), prompt: prompt});
            });
            return rows;
        }
        function parseFull(text) {
            text = String(text || '');
            var blocks = [], re = /\{([^{}|]+)\}/g, heads = [], m;
            while ((m = re.exec(text)) !== null) { if (m[1].trim()) heads.push({name: m[1].trim(), start: m.index, body: re.lastIndex}); }
            heads.forEach(function (h, i) {
                var body = text.slice(h.body, i + 1 < heads.length ? heads[i + 1].start : text.length);
                var nl = body.indexOf('\n');
                blocks.push({name: h.name, label: (nl >= 0 ? body.slice(0, nl) : body).trim(), options: parseLines(nl >= 0 ? body.slice(nl + 1) : '')});
            });
            return blocks;
        }
        function applyFull(text, quiet) {
            var blocks = parseFull(text);
            if (!blocks.length) { if (!quiet) PB.toast('{변수} 형식의 내용이 없습니다.', 'warn'); return 0; }
            blocks.forEach(function (b) {
                vars[b.name] = {label: b.label || (vars[b.name] || {}).label || b.name, options: b.options.length ? b.options : [{name: '1', prompt: ''}]};
            });
            markDirty();
            return blocks.length;
        }
        function buildCode() {
            var lines = ['[제목]', model.title, '', '[Positive]', model.positive, ''];
            if (model.negative) lines.push('[Negative]', model.negative, '');
            lines.push('[Full Options]');
            extractVars().forEach(function (n) {
                var v = vars[n];
                lines.push('{' + n + '} ' + (v.label || n));
                v.options.forEach(function (o) { if (o.name || o.prompt) lines.push((o.name || '') + ' | ' + (o.prompt || '')); });
                lines.push('');
            });
            return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
        }
        function importCode(text) {
            var sec = {}, cur = null;
            String(text || '').replace(/^﻿/, '').split(/\r?\n/).forEach(function (line) {
                var m = /^\[(제목|Positive|Negative|Full Options)\]\s*$/.exec(line.trim());
                if (m) { cur = m[1]; sec[cur] = []; return; }
                if (cur) sec[cur].push(line);
            });
            if (!sec['Positive'] && !sec['Full Options']) { PB.toast('템플릿 코드 형식이 아닙니다.', 'error'); return; }
            if (sec['제목']) model.title = sec['제목'].join('\n').trim() || model.title;
            if (sec['Positive']) model.positive = sec['Positive'].join('\n').trim();
            if (sec['Negative']) model.negative = sec['Negative'].join('\n').trim();
            if (sec['Full Options']) applyFull(sec['Full Options'].join('\n'), true);
            markDirty();
            render();
            PB.toast('템플릿 코드를 불러왔습니다.');
        }
        function download(name, text) {
            var a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob(['﻿' + text], {type: 'text/plain;charset=utf-8'}));
            a.download = name;
            document.body.appendChild(a);
            a.click();
            setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        }

        /* 썸네일: 500×500 가운데 자르기 → WebP */
        function setThumbFromSrc(src) {
            var img = new Image();
            img.onload = function () {
                var c = document.createElement('canvas');
                c.width = c.height = 500;
                var s = Math.min(img.naturalWidth, img.naturalHeight);
                c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 500, 500);
                model.thumbnail = c.toDataURL('image/webp', 0.88);
                model.removeThumb = false;
                markDirty();
                render();
            };
            img.onerror = function () { PB.toast('이미지를 읽을 수 없습니다.', 'error'); };
            img.src = src;
        }
        function readFile(file) {
            if (!file || !/^image\//.test(file.type)) return PB.toast('이미지 파일만 쓸 수 있습니다.', 'warn');
            var r = new FileReader();
            r.onload = function () { setThumbFromSrc(r.result); };
            r.readAsDataURL(file);
        }
        function pickFromGallery() {
            PB.api('/api/comfy/status?limit=300').then(function (d) {
                var imgs = [];
                ((d && d.jobs) || []).forEach(function (j) { if (j.status === 'completed') (j.images || []).forEach(function (im) { imgs.push({url: im.url, thumb: im.thumb || im.url, label: j.template_label}); }); });
                if (!imgs.length) return PB.toast('생성한 이미지가 없습니다.', 'warn');
                var back = document.createElement('div');
                back.className = 'dialog-backdrop';
                back.innerHTML = '<div class="dialog dialog-wide"><div class="dialog-head"><h3>생성 이미지에서 고르기</h3><button type="button" class="icon-btn" data-x>' + icon('x') + '</button></div><div class="thumb-pick">' +
                    imgs.slice(0, 120).map(function (im, i) { return '<button type="button" data-i="' + i + '" title="' + esc(im.label || '') + '"><img src="' + esc(im.thumb) + '" loading="lazy" alt=""></button>'; }).join('') + '</div></div>';
                document.body.appendChild(back);
                back.addEventListener('click', function (e) {
                    var b = e.target.closest('[data-i]');
                    if (b) { setThumbFromSrc(imgs[parseInt(b.getAttribute('data-i'), 10)].url); back.remove(); }
                    else if (e.target === back || e.target.closest('[data-x]')) back.remove();
                });
            });
        }

        function autoGrow(ta) {
            if (!ta) return;
            ta.style.height = 'auto';
            ta.style.height = Math.min(520, Math.max(150, ta.scrollHeight + 2)) + 'px';
        }

        function save(stay) {
            if (!model.title.trim()) { tab = 'basic'; render(); $('#edTitle').focus(); return PB.toast('제목을 입력하세요.', 'warn'); }
            if (!model.positive.trim() && !model.negative.trim()) { tab = 'basic'; render(); return PB.toast('Positive Prompt를 입력하세요.', 'warn'); }
            var full = $('#edFull');
            if (full && full.value.trim()) { applyFull(full.value, true); full.value = ''; }
            var names = extractVars(), payload = {};
            names.forEach(function (n) { payload[n] = vars[n]; });
            var nl = {};
            $$('[data-nl]').forEach(function (i) { nl[i.getAttribute('data-nl')] = i.value.trim(); });
            var body = {id: T.id || 0, title: model.title, style_id: model.style_id, positive: model.positive, negative: model.negative,
                tags: model.tags, variables: payload, lora_ids: model.lora, new_lora: nl.filename ? nl : null, thumbnail: model.thumbnail, remove_thumbnail: model.removeThumb};
            $('#edSave').disabled = $('#edSaveStay').disabled = true;
            PB.api('/api/templates/save', body).then(function (d) {
                $('#edSave').disabled = $('#edSaveStay').disabled = false;
                if (!d || !d.ok) return PB.toast((d && d.message) || '저장하지 못했습니다.', 'error');
                dirty = false;
                if (!stay) { location.href = '/templates'; return; }
                if (!T.id || nl.filename || inlineCount()) { location.replace('/templates/' + d.id); return; }
                PB.toast('저장했습니다.');
                $('#edTitleHead').textContent = model.title;
            });
        }

        /* 이벤트 */
        var ed = $('#editor');
        ed.addEventListener('input', function (e) {
            var t = e.target;
            if (t.id === 'edTitle') model.title = t.value;
            else if (t.id === 'edPositive') { model.positive = t.value; autoGrow(t); refreshChips(); }
            else if (t.id === 'edNegative') { model.negative = t.value; refreshChips(); }
            else if (t.id === 'edTags') model.tags = t.value;
            else if (t.id === 'varLabel') {
                vars[currentVar].label = t.value;
                var nm = $('.var-item.is-active .var-name');
                if (nm) nm.textContent = t.value && t.value !== currentVar ? t.value.replace(/_/g, ' ') : currentVar;
            } else if (t.matches('[data-o]')) {
                var i = parseInt(t.closest('[data-i]').getAttribute('data-i'), 10);
                vars[currentVar].options[i][t.getAttribute('data-o')] = t.value;
                var cnt = $('.var-item.is-active .var-n');
                if (cnt) {
                    var filled = vars[currentVar].options.filter(function (o) { return o.prompt.trim(); }).length;
                    cnt.textContent = filled;
                    cnt.classList.toggle('is-empty', !filled);
                }
            } else if (t.id === 'edLoraSearch') {
                var q = t.value.trim().toLowerCase();
                $$('#edLoraList .lora-row').forEach(function (r) { r.hidden = !!q && r.getAttribute('data-search').indexOf(q) === -1; });
                return;
            } else return;
            markDirty();
        });
        ed.addEventListener('change', function (e) {
            var t = e.target;
            if (t.id === 'edStyle' && t.value === 'new') {
                t.value = String(model.style_id);
                PB.promptText('새 스타일 이름', '', {placeholder: '예: 60. 판타지'}).then(function (name) {
                    if (!name) return;
                    PB.api('/api/styles/save', {id: 0, label: name}).then(function (d) {
                        if (!d.ok) return PB.toast(d.message, 'error');
                        B.styles = (B.styles || []).concat([{id: d.id, label: name}]).sort(function (a, b) { return String(a.label).localeCompare(String(b.label), 'ko', {numeric: true}); });
                        model.style_id = d.id;
                        markDirty();
                        render();
                        PB.toast('‘' + name + '’ 스타일을 만들었습니다.');
                    });
                });
            } else if (t.id === 'edStyle') { model.style_id = parseInt(t.value, 10) || 0; markDirty(); }
            if (t.id === 'edFile' && t.files[0]) readFile(t.files[0]);
        });
        ed.addEventListener('click', function (e) {
            var t = e.target;
            var gv = t.closest('[data-goto-var]');
            if (gv) { currentVar = gv.getAttribute('data-goto-var'); tab = 'details'; render(); return; }
            var tb = t.closest('[data-tab]');
            if (tb) { tab = tb.getAttribute('data-tab'); render(); return; }
            var lr = t.closest('[data-lora]');
            if (lr) {
                var id = parseInt(lr.getAttribute('data-lora'), 10), i = model.lora.indexOf(id);
                if (i === -1) model.lora.push(id); else model.lora.splice(i, 1);
                lr.classList.toggle('is-on', i === -1);
                $('#edLoraCount').textContent = model.lora.length || '';
                markDirty();
                return;
            }
            if (t.closest('#edPickFile')) return $('#edFile').click();
            if (t.closest('#edPickGallery')) return pickFromGallery();
            if (t.closest('#edThumbClear')) { model.thumbnail = ''; model.removeThumb = true; markDirty(); render(); return; }
            if (t.closest('#edThumb')) return $('#edFile').click();
            if (t.closest('#edApplyFull')) {
                var n = applyFull($('#edFull').value);
                if (n) { $('#edFull').value = ''; PB.toast(n + '개 세부 항목에 반영했습니다.'); render(); }
                return;
            }
            if (t.closest('#edExport')) return download((model.title.trim() || 'template').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 60) + '.txt', buildCode());
            if (t.closest('#edImport')) {
                var inp = document.createElement('input');
                inp.type = 'file';
                inp.accept = '.txt,text/plain';
                inp.onchange = function () { var f = inp.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { importCode(r.result); }; r.readAsText(f, 'utf-8'); };
                inp.click();
                return;
            }
            var vi = t.closest('[data-var]');
            if (vi && vi.closest('.var-list')) { currentVar = vi.getAttribute('data-var'); renderDetails(extractVars()); return; }
            var od = t.closest('[data-o-del]');
            if (od) { var opts = vars[currentVar].options; opts.splice(parseInt(od.getAttribute('data-o-del'), 10), 1); if (!opts.length) opts.push({name: '1', prompt: ''}); markDirty(); renderDetails(extractVars()); return; }
            var ou = t.closest('[data-o-up]');
            if (ou) { var k = parseInt(ou.getAttribute('data-o-up'), 10), o2 = vars[currentVar].options; var tmp = o2[k - 1]; o2[k - 1] = o2[k]; o2[k] = tmp; markDirty(); renderDetails(extractVars()); return; }
            if (t.closest('#optAdd')) {
                vars[currentVar].options.push({name: '', prompt: ''});
                markDirty();
                renderDetails(extractVars());
                var rows = $$('#optList .opt-row');
                var last = rows[rows.length - 1];
                if (last) last.querySelector('input').focus();
                return;
            }
            if (t.closest('#optClear')) { vars[currentVar].options = [{name: '1', prompt: ''}]; markDirty(); renderDetails(extractVars()); return; }
            if (t.closest('#bulkReplace') || t.closest('#bulkAppend')) {
                var rowsIn = parseLines($('#bulkText').value);
                if (!rowsIn.length) return PB.toast('입력한 줄이 없습니다.', 'warn');
                var cur = vars[currentVar].options.filter(function (o) { return o.name.trim() || o.prompt.trim(); });
                vars[currentVar].options = t.closest('#bulkReplace') ? rowsIn : cur.concat(rowsIn);
                markDirty();
                renderDetails(extractVars());
                PB.toast(rowsIn.length + '개 옵션을 반영했습니다.');
            }
        });
        ['dragover', 'drop'].forEach(function (ev) {
            ed.addEventListener(ev, function (e) {
                var zone = e.target.closest && e.target.closest('#edThumb');
                if (!zone) return;
                e.preventDefault();
                if (ev === 'drop' && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
            });
        });
        $('#edTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-t]'); if (!b) return; tab = b.getAttribute('data-t'); render(); });
        $('#edSave').addEventListener('click', function () { save(false); });
        $('#edSaveStay').addEventListener('click', function () { save(true); });
        var use = $('#edUse');
        if (use) use.addEventListener('click', function () {
            var go = function () { location.href = '/builder?template=' + T.id; };
            if (dirty) PB.confirm('저장하지 않은 변경이 있습니다', '저장하지 않고 빌더로 이동할까요?', {confirmText: '이동'}).then(function (ok) { if (ok) go(); });
            else go();
        });
        document.addEventListener('keydown', function (e) {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(true); }
        });
        document.addEventListener('click', function (e) {
            var a = e.target.closest('a[href]');
            if (!a || !dirty || a.closest('#editor') || a.getAttribute('download') != null) return;
            e.preventDefault();
            PB.confirm('저장하지 않은 변경이 있습니다', '저장하지 않고 나갈까요?', {confirmText: '나가기'}).then(function (ok) { if (ok) { dirty = false; location.href = a.href; } });
        }, true);
        render();
    }
})();
