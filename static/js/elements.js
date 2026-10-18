/* LOOM — 프롬프트 요소: 종류 · 그룹별로 보고 바로 등록 · 수정 · 삭제 */
(function () {
    'use strict';
    var PB = window.PB, B = window.PB_BOOT || {}, esc = PB.esc, icon = PB.icon;
    function $(s, r) { return (r || document).querySelector(s); }
    function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

    var items = B.items || [], types = B.types || [];
    var query = '', editing = null, flashId = 0;
    var TYPE_ICON = {person: 'user', makeup: 'sparkles', hair: 'user', outfit: 'shirt', pose: 'pose', accessory: 'gem',
        tattoo: 'pen', camera: 'camera', quality_render: 'sliders'};
    // 상위 항목: 앞 단계 그룹의 이름 중에서 고른다 (빌더가 이것으로 목록을 거른다)
    var PARENT_FROM = {'camera|렌즈': '카메라바디', 'accessory|악세사리 위치': '악세사리 카테고리', 'accessory|악세사리 디자인': '악세사리 위치'};

    var cur = (location.hash || '').slice(1);
    try { if (!cur) cur = localStorage.getItem('pb.el.type') || ''; } catch (e) {}
    if (!typeOf(cur)) cur = (types.filter(function (t) { return t.count; })[0] || types[0] || {}).key || '';

    function typeOf(key) { return types.filter(function (t) { return t.key === key; })[0]; }
    function typeLabel(key) { var t = typeOf(key); return t ? t.label : key; }
    function sectionsOf(type) {
        var out = [];
        items.forEach(function (e) { if (e.element_type === type && out.indexOf(e.section) < 0) out.push(e.section); });
        return out;
    }
    function parentChoices(type, section) {
        var out = [];
        function add(v) { if (v && out.indexOf(v) < 0) out.push(v); }
        var from = PARENT_FROM[type + '|' + section];
        items.forEach(function (e) {
            if (from && e.element_type === type && e.section === from) add(e.label_ko);
            if (e.element_type === type && e.section === section) add(e.parent_label);
        });
        return out;
    }
    function matches(e) {
        if (!query) return true;
        return (e.label_ko + ' ' + e.prompt + ' ' + e.section + ' ' + e.parent_label).toLowerCase().indexOf(query) !== -1;
    }

    /* ---------- 그리기 ---------- */
    function render() {
        $('#elCount').textContent = items.length.toLocaleString() + '개';
        var nav = types.map(function (t) {
            return '<button type="button" class="el-type' + (!query && t.key === cur ? ' is-active' : '') + '" data-type="' + esc(t.key) + '">' +
                icon(TYPE_ICON[t.key] || 'tag') + '<span class="el-type-name">' + esc(t.label) + '</span><span class="el-type-n">' + (t.count || '') + '</span></button>';
        }).join('');
        $('#elements').innerHTML = '<nav class="el-types">' + nav + '</nav><div class="el-main">' + (query ? searchHtml() : typeHtml()) + '</div>';
        if (flashId) {
            var row = $('.el-item[data-id="' + flashId + '"]');
            if (row) { row.classList.add('is-flash'); if (!editing) row.scrollIntoView({block: 'nearest'}); }
            flashId = 0;
        }
    }
    function itemHtml(e, withType) {
        return '<div class="el-item' + (e.is_active ? '' : ' is-off') + '" data-id="' + e.id + '">' +
            '<div class="el-item-main"><div class="el-item-name">' + (withType ? '<span class="faint">' + esc(typeLabel(e.element_type)) + ' › ' + esc(e.section) + ' › </span>' : '') +
            (e.parent_label ? '<span class="chip">' + esc(e.parent_label) + '</span>' : '') + '<b>' + esc(e.label_ko) + '</b>' +
            (e.is_active ? '' : '<span class="chip">사용 안 함</span>') + '</div>' +
            '<div class="el-item-prompt">' + esc(e.prompt) + '</div></div>' +
            '<button type="button" class="icon-btn sm" data-act="edit" title="수정">' + icon('pen') + '</button>' +
            '<button type="button" class="icon-btn sm" data-act="delete" title="삭제">' + icon('trash') + '</button></div>';
    }
    function typeHtml() {
        var t = typeOf(cur);
        if (!t) return '<div class="pb-empty">프롬프트 요소가 없습니다. 데이터 메뉴에서 프롬프트 요소 파일을 가져오세요.</div>';
        var groups = sectionsOf(cur);
        var head = '<div class="el-head"><h2>' + icon(TYPE_ICON[cur] || 'tag') + esc(t.label) + '</h2><span class="faint">' +
            [t.count + '개', groups.length ? '그룹 ' + groups.length + '개' : '', t.where].filter(Boolean).join(' · ') + '</span>' +
            (t.free ? '' : '<span class="chip" title="빌더의 그룹 구성이 정해져 있습니다">있는 그룹에만 추가</span>') + '</div>';
        // 새 요소 양식: 그룹의 + 로 열었으면 그 그룹 맨 위에, 아니면 화면 맨 위에
        var inGroup = editing && !editing.id && editing.at && editing.element_type === cur && groups.indexOf(editing.at) >= 0;
        var form = editing && !editing.id && !inGroup ? formHtml() : '';
        var body = groups.map(function (sec) {
            var list = items.filter(function (e) { return e.element_type === cur && e.section === sec; });
            var top = inGroup && editing.at === sec ? formHtml() : '';
            return '<section class="card el-group"><div class="card-title"><span>' + esc(sec) + '</span><span class="sub">' + list.length + '개</span>' +
                '<div class="actions"><button type="button" class="icon-btn sm" data-add-section="' + esc(sec) + '" title="이 그룹에 추가">' + icon('plus') + '</button></div></div>' +
                '<div class="el-list">' + top + list.map(function (e) { return editing && editing.id === e.id ? formHtml() : itemHtml(e); }).join('') + '</div></section>';
        }).join('');
        if (!groups.length) body = '<div class="pb-empty">' + (t.free ? '아직 요소가 없습니다. ‘요소 추가’로 첫 그룹과 요소를 만드세요.' : '이 종류는 빌더의 그룹이 정해져 있어, 프롬프트 요소 파일을 가져와 그룹이 생긴 뒤에 추가할 수 있습니다. 데이터 메뉴에서 가져오세요.') + '</div>';
        return head + form + body;
    }
    function searchHtml() {
        var hits = items.filter(matches);
        var head = '<div class="el-head"><h2>' + icon('search') + '검색 결과</h2><span class="faint">‘' + esc(query) + '’ · ' + hits.length + '개 (모든 종류)</span></div>';
        var form = editing && !editing.id ? formHtml() : '';
        if (!hits.length) return head + form + '<div class="pb-empty">찾는 요소가 없습니다.</div>';
        return head + form + '<section class="card el-group el-search"><div class="el-list">' + hits.slice(0, 500).map(function (e) {
            return editing && editing.id === e.id ? formHtml() : itemHtml(e, true);
        }).join('') + '</div>' + (hits.length > 500 ? '<p class="help">처음 500개만 보입니다. 검색어를 더 적어 주세요.</p>' : '') + '</section>';
    }

    /* ---------- 입력 양식 ---------- */
    var NEW_GROUP = '\u0000new';
    function formHtml() {
        var e = editing, t = typeOf(e.element_type) || {free: true};
        var groups = sectionsOf(e.element_type);
        var isNewGroup = e.section === NEW_GROUP || (e.section && groups.indexOf(e.section) < 0);
        var groupOpts = groups.map(function (g) { return '<option value="' + esc(g) + '"' + (g === e.section ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('') +
            (t.free ? '<option value="' + NEW_GROUP + '"' + (isNewGroup ? ' selected' : '') + '>＋ 새 그룹…</option>' : '');
        var parents = parentChoices(e.element_type, isNewGroup ? '' : e.section);
        var showParent = parents.length || e.parent_label;
        return '<div class="lora-form el-form" id="elForm">' +
            '<div class="field-grid el-form-grid">' +
            '<label class="field"><span>종류</span><select class="input" data-ef="element_type">' + types.map(function (x) {
                return '<option value="' + esc(x.key) + '"' + (x.key === e.element_type ? ' selected' : '') + '>' + esc(x.label) + '</option>';
            }).join('') + '</select></label>' +
            '<label class="field"><span>그룹</span><select class="input" data-ef="section">' + (groupOpts || '<option value="">그룹 없음</option>') + '</select></label>' +
            (isNewGroup ? '<label class="field"><span>새 그룹 이름</span><input class="input" data-ef="new_section" value="' + esc(e.section === NEW_GROUP ? (e.new_section || '') : e.section) + '" placeholder="예: 액세서리 소품"></label>' : '') +
            (showParent ? '<label class="field"><span>상위 항목 <small class="faint">선택</small></span><input class="input" data-ef="parent_label" list="elParents" value="' + esc(e.parent_label || '') + '" placeholder="비우면 모든 경우에 보임">' +
                '<datalist id="elParents">' + parents.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist></label>' : '') +
            '</div>' +
            '<div class="field-grid el-form-grid" style="margin-top:10px">' +
            '<label class="field"><span>이름 *</span><input class="input" data-ef="label_ko" value="' + esc(e.label_ko || '') + '" placeholder="빌더에 보이는 이름 (예: 진주 귀걸이)"></label>' +
            '</div>' +
            '<label class="field" style="margin-top:10px"><span>프롬프트 *</span><textarea class="textarea mono" data-ef="prompt" rows="2" spellcheck="false" placeholder="예: pearl drop earrings">' + esc(e.prompt || '') + '</textarea></label>' +
            '<div class="set-actions"><label class="switch"><input type="checkbox" data-ef="is_active"' + (e.is_active ? ' checked' : '') + '>사용</label>' +
            '<span class="faint">프롬프트에서 <kbd>↵</kbd> 저장 · <kbd>Esc</kbd> 취소</span><div style="flex:1"></div>' +
            '<button type="button" class="btn btn-ghost" data-act="cancel">취소</button>' +
            '<button type="button" class="btn btn-primary" data-act="save">' + icon('check') + (e.id ? '저장' : '추가') + '</button></div></div>';
    }
    function readForm() {
        var f = $('#elForm');
        if (!f || !editing) return;
        $$('[data-ef]', f).forEach(function (i) { editing[i.getAttribute('data-ef')] = i.type === 'checkbox' ? i.checked : i.value; });
    }
    function startAdd(type, section) {
        type = type || cur;
        var groups = sectionsOf(type), t = typeOf(type) || {};
        editing = {id: 0, element_type: type, section: section || groups[0] || (t.free ? NEW_GROUP : ''),
            parent_label: '', label_ko: '', prompt: '', is_active: true, at: section || ''};
        if (query) { query = ''; $('#elSearch').value = ''; }
        if (type !== cur) setType(type, true);
        render();
        focusForm();
    }
    function focusForm() {
        var f = $('#elForm');
        if (!f) return;
        f.scrollIntoView({block: 'nearest'});
        var first = $('[data-ef="new_section"]', f);
        (first && !first.value ? first : $('[data-ef="label_ko"]', f)).focus();
    }
    function save() {
        readForm();
        var e = editing, data = {id: e.id, element_type: e.element_type, section: e.section === NEW_GROUP || sectionsOf(e.element_type).indexOf(e.section) < 0 ? (e.new_section || '').trim() : e.section,
            parent_label: e.parent_label || '', label_ko: e.label_ko, prompt: e.prompt, is_active: !!e.is_active};
        PB.api('/api/elements/save', data).then(function (d) {
            if (!d.ok) return PB.toast(d.message, 'error');
            items = d.items; types = d.types;
            flashId = d.id;
            if (e.id) {
                editing = null;
                PB.toast('‘' + data.label_ko + '’을(를) 저장했습니다.');
            } else {
                // 이어서 같은 그룹에 바로 더 넣을 수 있게 양식을 비워 둔다
                editing = {id: 0, element_type: data.element_type, section: data.section, parent_label: data.parent_label,
                    label_ko: '', prompt: '', is_active: true, at: e.at ? data.section : ''};
                PB.toast('‘' + data.label_ko + '’을(를) 추가했습니다. 이어서 더 넣을 수 있어요.');
            }
            if (data.element_type !== cur && !query) setType(data.element_type, true);
            render();
            if (editing) focusForm();
        });
    }
    function remove(e) {
        PB.confirm('‘' + e.label_ko + '’ 요소를 삭제할까요?', typeLabel(e.element_type) + ' › ' + e.section + '\n' + e.prompt +
            '\n\n빌더 목록에서 사라지고 되돌릴 수 없습니다. 지우지 않고 숨기려면 수정에서 ‘사용’을 끄세요.', {confirmText: '삭제', danger: true}).then(function (ok) {
            if (!ok) return;
            PB.api('/api/elements/delete', {ids: [e.id]}).then(function (d) {
                if (!d.ok) return PB.toast(d.message, 'error');
                items = d.items; types = d.types;
                if (editing && editing.id === e.id) editing = null;
                render();
                PB.toast('‘' + e.label_ko + '’을(를) 삭제했습니다.');
            });
        });
    }
    function setType(key, quiet) {
        cur = key;
        try { localStorage.setItem('pb.el.type', key); } catch (err) {}
        history.replaceState(null, '', '#' + key);
        if (!quiet) { editing = null; render(); var c = $('.content'); if (c) c.scrollTop = 0; }
    }

    /* ---------- 동작 ---------- */
    document.addEventListener('click', function (ev) {
        var t = ev.target;
        var ty = t.closest('[data-type]');
        if (ty) {
            if (query) { query = ''; $('#elSearch').value = ''; }
            return setType(ty.getAttribute('data-type'));
        }
        if (t.closest('#elAdd')) return startAdd(cur);
        var as = t.closest('[data-add-section]');
        if (as) return startAdd(cur, as.getAttribute('data-add-section'));
        var act = t.closest('[data-act]');
        if (!act) return;
        var a = act.getAttribute('data-act');
        if (a === 'cancel') { editing = null; return render(); }
        if (a === 'save') return save();
        var row = act.closest('.el-item');
        var e = row && items.filter(function (x) { return x.id === +row.getAttribute('data-id'); })[0];
        if (!e) return;
        if (a === 'edit') {
            editing = {id: e.id, element_type: e.element_type, section: e.section, parent_label: e.parent_label,
                label_ko: e.label_ko, prompt: e.prompt, is_active: !!e.is_active};
            render();
            focusForm();
        }
        if (a === 'delete') remove(e);
    });
    document.addEventListener('change', function (ev) {
        var f = ev.target.getAttribute && ev.target.getAttribute('data-ef');
        if (f !== 'element_type' && f !== 'section') return;
        readForm();
        if (f === 'element_type') {  // 종류를 바꾸면 그 종류의 첫 그룹으로
            var t = typeOf(editing.element_type) || {};
            editing.section = sectionsOf(editing.element_type)[0] || (t.free ? NEW_GROUP : '');
            editing.parent_label = '';
        }
        var html = formHtml(), box = $('#elForm');
        if (box) { box.outerHTML = html; }
        if (editing.section === NEW_GROUP) { var ns = $('[data-ef="new_section"]'); if (ns) ns.focus(); }
    });
    document.addEventListener('keydown', function (ev) {
        if (!$('#elForm') || !ev.target.closest || !ev.target.closest('#elForm')) return;
        var tg = ev.target;
        if (ev.isComposing) return;  // 한글 입력 중의 Enter
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); save(); }
        else if (ev.key === 'Enter' && tg.getAttribute('data-ef') === 'prompt' && !ev.shiftKey) { ev.preventDefault(); save(); }
        else if (ev.key === 'Enter' && tg.tagName === 'INPUT' && tg.type !== 'checkbox') {
            // 다음 칸으로 (마지막 칸인 프롬프트에서 Enter = 저장, Shift+Enter = 줄바꿈)
            ev.preventDefault();
            var fields = $$('#elForm input.input, #elForm textarea'), i = fields.indexOf(tg);
            if (fields[i + 1]) fields[i + 1].focus(); else save();
        }
        else if (ev.key === 'Escape') { ev.preventDefault(); editing = null; render(); }
    });
    $('#elSearch').addEventListener('input', PB.debounce(function () {
        readForm();
        query = $('#elSearch').value.trim().toLowerCase();
        render();
    }, 150));
    window.addEventListener('hashchange', function () {
        var k = location.hash.slice(1);
        if (k && k !== cur && typeOf(k)) setType(k);
    });

    render();
})();
