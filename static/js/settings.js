/* LOOM — ComfyUI 서버 · workflow · LoRA · 데이터 · 도움말 · 정보 (메인 메뉴마다 한 화면, B.section) */
(function () {
    'use strict';
    var PB = window.PB, B = window.PB_BOOT || {}, esc = PB.esc, icon = PB.icon;
    function $(s, r) { return (r || document).querySelector(s); }
    function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

    var cfg = B.settings || {};
    var workflows = B.workflows || [];
    var loras = B.loras || [];
    var editingLora = null;

    var CARDS = {};
    // 예전 '설정'의 하위 메뉴가 이제 메인 메뉴에 하나씩 있다: 화면마다 그 메뉴 하나만 그린다
    function currentSection() { return CARDS[B.section] ? B.section : 'server'; }
    function render() {
        var cur = currentSection();
        $('#settings').innerHTML = CARDS[cur]();
        if (cur === 'data') { loadPacks(); loadBackups(); }
    }
    function showSection() {
        render();
        if (currentSection() === 'server') pingAll();
        if (currentSection() === 'help' && location.hash) {  // /help#data 같은 주소: 그 주제로
            var topic = $('[data-help="' + location.hash.slice(1) + '"]');
            if (topic) topic.scrollIntoView({block: 'start'});
        }
    }

    /* ---------- 서버 ---------- */
    function serverCard() {
        var servers = (cfg.comfy_servers || []).slice();
        while (servers.length < 3) servers.push('');
        return '<section class="card set-card" id="server"><div class="card-title">' + icon('server') + '<span>ComfyUI 서버</span><span class="sub">최대 3개 · 첫 번째가 기본</span></div>' +
            servers.map(function (u, i) {
                return '<div class="srv-row"><span class="srv-n">' + (i + 1) + '</span><input class="input" data-srv="' + i + '" value="' + esc(u) + '" placeholder="' + (i === 0 ? 'http://127.0.0.1:8188' : '추가 서버 (선택)') + '" spellcheck="false">' +
                    '<button type="button" class="btn btn-sm" data-ping="' + i + '">' + icon('refresh') + '연결 확인</button><span class="srv-state" data-state="' + i + '"></span></div>';
            }).join('') +
            '<div class="set-row"><label class="field"><span>결과 대기 시간</span><div class="field-row"><input class="input" id="setTimeout" type="number" min="1" max="120" value="' + esc(cfg.timeout_minutes) + '" style="width:90px"><span class="muted">분 안에 결과가 없으면 실패로 처리</span></div></label></div>' +
            '<p class="help">ComfyUI를 <kbd>--listen</kbd> 없이 이 컴퓨터에서 켰다면 <b>http://127.0.0.1:8188</b> 그대로 쓰면 됩니다. 다른 컴퓨터의 ComfyUI는 그 컴퓨터 주소(예: http://192.168.0.10:8188)를 넣으세요. 이 앱이 ComfyUI로 직접 보내므로 CORS 설정은 필요 없습니다.</p>' +
            '<div class="set-actions"><button type="button" class="btn btn-primary" id="saveServer">' + icon('check') + '저장</button></div></section>';
    }

    /* ---------- workflow ---------- */
    function workflowCard() {
        var rows = workflows.map(function (w) {
            var s = w.summary || {};
            var isDef = cfg.default_workflow_id === w.id;
            var chips = [s.size, s.sampler, s.loras ? 'LoRA 노드 ' + s.loras : ''].filter(Boolean).map(function (x) { return '<span class="chip">' + esc(x) + '</span>'; }).join('');
            var warn = !s.positive ? '<span class="chip bad" title="CLIPTextEncode 노드나 {{positive}} 자리가 없어 프롬프트가 들어가지 않을 수 있습니다">프롬프트 자리 없음</span>' : '';
            return '<div class="wf-row" data-wf="' + esc(w.id) + '">' +
                '<button type="button" class="icon-btn sm' + (isDef ? ' is-on' : '') + '" data-wf-default title="' + (isDef ? '기본 workflow' : '기본으로 지정') + '">' + icon('star') + '</button>' +
                '<div class="wf-main"><div class="wf-name">' + esc(w.name) + '</div><div class="wf-chips">' + chips + warn +
                (s.positive ? '<span class="faint" title="Positive가 들어가는 노드">→ ' + esc(s.positive) + '</span>' : '') + '</div></div>' +
                '<span class="faint wf-date">' + esc(w.modified) + '</span>' +
                '<button type="button" class="icon-btn sm" data-wf-rename title="이름 바꾸기">' + icon('pen') + '</button>' +
                '<a class="icon-btn sm" href="/api/workflows/' + esc(w.id) + '/download" download title="JSON 저장">' + icon('download') + '</a>' +
                '<button type="button" class="icon-btn sm" data-wf-delete title="삭제">' + icon('trash') + '</button></div>';
        }).join('');
        return '<section class="card set-card" id="workflows"><div class="card-title">' + icon('file') + '<span>Workflow</span><span class="sub">' + workflows.length + '개</span>' +
            '<div class="actions"><button type="button" class="btn btn-sm btn-ghost" data-open="workflows">' + icon('folder') + '폴더</button></div></div>' +
            '<div class="drop" id="wfDrop">' + icon('upload') + '<div><b>workflow JSON 추가</b><span>ComfyUI 메뉴 <b>Workflow → Export (API)</b>로 저장한 파일을 끌어다 놓거나 눌러서 고르세요. 여러 개 가능.</span></div><input type="file" id="wfFile" accept=".json,application/json" multiple hidden></div>' +
            '<div class="wf-list">' + (rows || '<div class="pb-empty">workflow가 없습니다.</div>') + '</div>' +
            '<p class="help">프롬프트는 <b>{{positive}}</b> / <b>{{negative}}</b> 자리, 제목이 ‘positive prompt’인 문자열 노드, 또는 CLIPTextEncode 노드 순서로 찾아 넣습니다. 크기·CFG·Steps는 빌더에서 바꿀 수 있고, seed는 생성할 때마다 무작위로 바뀝니다.</p></section>';
    }

    /* ---------- LoRA ---------- */
    function loraForm(l) {
        l = l || {idx: 0, title: '', filename: '', support_type: '', default_strength: 1, trigger_text: '', url: '', description: '', is_active: 1};
        return '<div class="lora-form" id="loraForm">' +
            '<div class="field-grid">' +
            '<label class="field"><span>파일명 *</span><input class="input" data-lf="filename" value="' + esc(l.filename) + '" placeholder="myLora.safetensors" spellcheck="false"></label>' +
            '<label class="field"><span>제목</span><input class="input" data-lf="title" value="' + esc(l.title) + '" placeholder="비우면 파일명"></label>' +
            '<label class="field"><span>지원 모델</span><input class="input" data-lf="support_type" value="' + esc(l.support_type) + '" placeholder="SDXL, Flux, Illustrious…"></label>' +
            '<label class="field"><span>기본 강도</span><input class="input" data-lf="default_strength" type="number" min="0" max="2" step="0.05" value="' + esc(l.default_strength) + '"></label>' +
            '<label class="field"><span>트리거 단어</span><input class="input" data-lf="trigger_text" value="' + esc(l.trigger_text || '') + '" spellcheck="false"></label>' +
            '<label class="field"><span>링크</span><input class="input" data-lf="url" value="' + esc(l.url || '') + '" placeholder="https://… (참고용)" spellcheck="false"></label>' +
            '</div><label class="field" style="margin-top:8px"><span>설명</span><input class="input" data-lf="description" value="' + esc(l.description || '') + '"></label>' +
            '<div class="set-actions"><label class="switch"><input type="checkbox" data-lf="is_active"' + (l.is_active ? ' checked' : '') + '>사용</label><div style="flex:1"></div>' +
            '<button type="button" class="btn btn-ghost" id="loraCancel">취소</button><button type="button" class="btn btn-primary" id="loraSave" data-idx="' + (l.idx || 0) + '">' + icon('check') + (l.idx ? '수정' : '추가') + '</button></div></div>';
    }
    function loraCard() {
        var rows = loras.map(function (l) {
            return '<div class="lora-item' + (l.is_active ? '' : ' is-off') + '" data-idx="' + l.idx + '"><div class="wf-main"><div class="wf-name">' + esc(l.title) + '</div>' +
                '<div class="wf-chips"><span class="faint mono-s">' + esc(l.filename) + '</span>' + (l.support_type ? '<span class="chip">' + esc(l.support_type) + '</span>' : '') +
                '<span class="chip">' + Number(l.default_strength || 1).toFixed(2) + '</span>' + (l.trigger_text ? '<span class="faint">' + esc(l.trigger_text) + '</span>' : '') + '</div></div>' +
                '<button type="button" class="icon-btn sm" data-lora-edit title="수정">' + icon('pen') + '</button>' +
                '<button type="button" class="icon-btn sm" data-lora-del title="삭제">' + icon('trash') + '</button></div>';
        }).join('');
        return '<section class="card set-card" id="lora"><div class="card-title">' + icon('link') + '<span>LoRA</span><span class="sub">' + loras.length + '개 · 빌더에서 고르면 &lt;lora:파일명:강도&gt; 태그로 들어갑니다</span>' +
            '<div class="actions"><button type="button" class="btn btn-sm" id="loraAdd">' + icon('plus') + 'LoRA 추가</button></div></div>' +
            (editingLora !== null ? loraForm(editingLora) : '') +
            '<div class="lora-items">' + (rows || '<div class="pb-empty">등록된 LoRA가 없습니다.</div>') + '</div></section>';
    }

    /* ---------- 데이터 ---------- */
    var store = B.storage || {};
    function fmtSize(n) {
        n = Number(n || 0);
        if (n >= 1073741824) return (n / 1073741824).toFixed(1) + 'GB';
        if (n >= 1048576) return Math.round(n / 1048576) + 'MB';
        return Math.max(1, Math.round(n / 1024)) + 'KB';
    }
    function storageBox() {
        var pend = store.pending;
        var html = '<div class="storage-box"><div class="storage-main">' + icon('folder') +
            '<div class="storage-text"><b>저장 위치</b><span class="storage-path">' + esc(store.data_dir || '') + '</span>' +
            '<span class="faint">' + fmtSize(store.size) + ' · ' + (store.is_default ? '기본 위치 (문서 폴더)' : '사용자 지정 위치') + ' · DB · 이미지 · workflow · 생성 결과 · 백업</span></div></div>' +
            '<div class="set-actions" style="justify-content:flex-start;margin-top:12px">' +
            '<button type="button" class="btn btn-sm" data-open="data">' + icon('folder') + '' + PB.fileManager + '에서 보기</button>' +
            '<button type="button" class="btn btn-sm btn-primary" id="stChange">' + icon('swap') + '위치 변경…</button>' +
            (store.is_default ? '' : '<button type="button" class="btn btn-sm btn-ghost" id="stDefault">' + icon('undo') + '기본 위치로</button>') + '</div>';
        if (pend) {
            html += '<div class="storage-note is-pending">' + icon('clock') + '<div><b>' + (pend.mode === 'use' ? '다시 시작하면 이 위치의 데이터를 씁니다' : '다시 시작하면 데이터를 옮깁니다') + '</b>' +
                '<span class="storage-path">' + esc(pend.to) + '</span></div>' +
                (B.canRestart ? '<button type="button" class="btn btn-sm btn-primary" id="stRestart">' + icon('refresh') + '지금 다시 시작</button>' : '<span class="faint">앱을 끄고 다시 실행하세요</span>') +
                '<button type="button" class="btn btn-sm btn-ghost" id="stCancel">취소</button></div>';
        }
        if (store.last_error) {
            html += '<div class="storage-note is-error">' + icon('alert') + '<div><b>이동하지 못했습니다</b><span>' + esc(store.last_error) + '</span></div>' +
                '<button type="button" class="icon-btn sm" id="stClearError" title="닫기">' + icon('x') + '</button></div>';
        } else if (store.last_move && !pend) {
            html += '<p class="help">' + esc(store.last_move.at) + ' · ' + esc(store.last_move.from) + ' 에서 옮겨 왔습니다.</p>';
        }
        return html + '</div>';
    }
    /* 종류별 내보내기 · 가져오기 · 비우기 */
    var PACK_ICON = {templates: 'layers', elements: 'sliders', outfits: 'shirt', places: 'mountain'};
    var PACK_HINT = {templates: '스타일 · 썸네일 포함 · 스타일을 골라 내보내고 가져올 수 있음', elements: '배경 슬롯 옵션 포함 · 종류(인물 · 메이크업 · 의상 …)를 골라 내보내고 가져올 수 있음', outfits: '미리보기 이미지 포함 (두 모델)', places: '미리보기 이미지 포함 (두 모델)'};
    var packs = null, packJobs = 0, packBusy = '';
    function num(n) { return Number(n || 0).toLocaleString(); }
    function packMeta(p) {
        var bits = [num(p.count) + '개'];
        if (p.kind === 'templates') bits.push('스타일 ' + num(p.extra) + '개');
        if (p.kind === 'elements' && p.extra) bits.push('배경 옵션 ' + num(p.extra) + '개');
        if (p.images) bits.push('이미지 ' + num(p.images) + '개 · ' + fmtSize(p.size));
        return bits.join(' · ');
    }
    function packRows() {
        if (!packs) return '<div class="faint">불러오는 중…</div>';
        return packs.map(function (p) {
            var busy = packBusy && packBusy.split(':')[0] === p.kind ? packBusy.split(':')[1] : '';
            function btn(act, ic, label, cls, off) {
                return '<button type="button" class="btn btn-sm' + (cls || '') + '" data-pack="' + act + '"' + (packBusy || off ? ' disabled' : '') + '>' +
                    (busy === act ? '<span class="spinner"></span>' : icon(ic)) + label + '</button>';
            }
            var empty = !p.count && !p.images && !p.extra;
            return '<div class="pack-row" data-kind="' + p.kind + '">' + icon(PACK_ICON[p.kind] || 'database') +
                '<div class="pack-main"><b>' + esc(p.label) + '</b><span class="pack-meta">' + packMeta(p) + '</span><span class="faint">' + esc(PACK_HINT[p.kind] || '') + '</span></div>' +
                '<div class="pack-acts">' + btn('export', 'download', '내보내기', '', empty) + btn('import', 'upload', '가져오기') +
                btn('clear', 'trash', '비우기', ' btn-danger', empty) + '</div></div>';
        }).join('') + '<div class="pack-foot faint">생성 기록 ' + num(packJobs) + '개는 내보내기 대상이 아닙니다 (아래 백업에 포함).</div>';
    }
    function dataCard() {
        return '<section class="card set-card" id="data"><div class="card-title">' + icon('database') + '<span>데이터</span><span class="sub">모든 데이터는 이 컴퓨터의 저장 위치에만 있습니다</span></div>' +
            storageBox() +
            '<div class="section-title" style="margin-top:0">종류별 내보내기 · 가져오기</div>' +
            '<p class="help" style="margin-top:0">종류마다 파일(.zip) 하나에 담습니다. 썸네일·미리보기 이미지도 함께 담깁니다. 앱에는 데이터가 들어 있지 않으니, 따로 받은 템플릿 · 프롬프트 요소 · 의상 프리셋 · 유명 배경 파일을 여기서 가져오세요.</p>' +
            '<div class="pack-list" id="packList">' + packRows() + '</div>' +
            '<p class="help">템플릿은 스타일을, 프롬프트 요소는 종류(인물 · 메이크업 · 헤어 · 의상 …)를 골라 그것만 내보내고 가져올 수 있습니다. 하나씩 등록 · 삭제는 <a class="link" href="/elements">프롬프트 요소</a> 메뉴에서 합니다. 가져오기는 지금 데이터에 더합니다. 템플릿 제목이 이미 있으면 ‘제목 (1)’, ‘제목 (2)’로 넣고, 스타일은 이름이 같으면 이미 있는 스타일을 씁니다. 프롬프트 요소·의상·유명 배경은 같은 항목이 있으면 그대로 두고 건너뜁니다. 가져오기·비우기 전에는 DB를 자동으로 백업하고, 비운 이미지는 휴지통으로 보냅니다.</p>' +
            '<div class="divider"></div>' +
            '<div class="section-title" style="margin-top:0">백업 · 복원</div>' +
            '<p class="help" style="margin-top:0">DB 전체(템플릿·요소·프리셋·LoRA·생성 기록)를 저장 위치의 backups 폴더에 통째로 저장합니다. 이미지 파일은 들어가지 않습니다. 복원하면 그 시점으로 돌아가며, 복원 직전 상태도 자동으로 백업합니다.</p>' +
            '<div class="set-actions" style="justify-content:flex-start"><button type="button" class="btn btn-sm" id="backupNow">' + icon('download') + '지금 백업</button></div>' +
            '<div class="backup-list" id="backupList"><div class="faint">불러오는 중…</div></div></section>';
    }
    function refreshStorage() {
        return PB.api('/api/storage').then(function (d) {
            if (!d || !d.ok) return;
            store = d;
            B.canRestart = d.can_restart;
            render();
        });
    }
    function loadPacks() {
        return PB.api('/api/data/packs').then(function (d) {
            if (!d || !d.ok) return;
            packs = d.items || [];
            packJobs = d.jobs || 0;
            var box = $('#packList');
            if (box) box.innerHTML = packRows();
        });
    }
    function setPackBusy(v) {
        packBusy = v;
        var box = $('#packList');
        if (box) box.innerHTML = packRows();
    }
    /* 템플릿 스타일 · 프롬프트 요소 종류 고르기: 고른 key 목록, 전부 고르면 undefined(전체), 취소하면 null.
       고를 것이 하나뿐이면 묻지 않고 전체로 한다. */
    function pickGroups(o) {
        var items = o.items.filter(function (s) { return s.count > 0; });
        if (items.length <= 1) return Promise.resolve(undefined);
        var rows = items.map(function (s, i) {
            return '<label class="pick-row"><input type="checkbox" data-i="' + i + '" checked><span class="pick-name">' + esc(s.label) + '</span>' +
                (s.note ? '<span class="pick-note">' + esc(s.note) + '</span>' : '') + '<span class="pick-n">' + num(s.count) + '개</span></label>';
        }).join('');
        var html = '<div class="pick"><label class="pick-row pick-all"><input type="checkbox" data-all checked><span class="pick-name">전체</span><span class="pick-n" data-sum></span></label>' +
            '<div class="pick-list">' + rows + '</div></div>';
        function checked(el) {
            return Array.prototype.slice.call(el.querySelectorAll('.pick-list input:checked')).map(function (b) { return items[+b.getAttribute('data-i')]; });
        }
        return PB.dialog({title: o.title, text: o.text, icon: 'info', html: html, confirmText: o.confirmText,
            onOpen: function (el) {
                var all = el.querySelector('[data-all]'), ok = el.querySelector('[data-r="ok"]');
                function sync() {
                    var on = checked(el), n = on.reduce(function (t, s) { return t + s.count; }, 0);
                    all.checked = on.length === items.length;
                    all.indeterminate = on.length > 0 && on.length < items.length;
                    el.querySelector('[data-sum]').textContent = num(n) + '개';
                    ok.disabled = !on.length;
                    ok.textContent = on.length ? o.confirmText + ' (' + num(n) + '개)' : o.confirmText;
                }
                el.querySelector('.pick').addEventListener('change', function (e) {
                    if (e.target === all) el.querySelectorAll('.pick-list input').forEach(function (b) { b.checked = all.checked; });
                    sync();
                });
                sync();
            },
            collect: function (el) {
                var on = checked(el);
                return on.length === items.length ? undefined : on.map(function (s) { return s.key; });
            }
        }).then(function (r) { return r.isConfirmed ? r.value : null; });
    }
    // path: 비우면 앱이 열기 대화상자로 묻는다. groups: 가져올 스타일 이름(템플릿) · 종류(프롬프트 요소) (undefined = 전부)
    function groupBody(kind, body, groups) {
        if (kind === 'templates') body.styles = groups;
        if (kind === 'elements') body.types = groups;
        return body;
    }
    function importPack(p, kind, path, groups) {
        setPackBusy(kind + ':import');
        PB.api('/api/data/import', groupBody(kind, {kind: kind, path: path}, groups)).then(function (d) {
            setPackBusy('');
            if (!d.ok) return PB.alert('가져오지 못했습니다', d.message, 'error');
            if (d.cancelled) return;
            var lines = [num(d.added) + '개를 가져왔습니다' + (d.total && d.total !== d.added ? ' (' + (groups ? (kind === 'templates' ? '고른 스타일에' : '고른 종류에') : '파일에') + ' ' + num(d.total) + '개)' : '') + '.'];
            if (d.renamed) lines.push('제목이 겹쳐 ‘(1)’ 등을 붙인 템플릿 ' + num(d.renamed) + '개');
            if (d.styles_added) lines.push('새로 만든 스타일 ' + num(d.styles_added) + '개');
            if (d.options_added) lines.push('추가한 배경 옵션 ' + num(d.options_added) + '개');
            if (d.skipped) lines.push('이미 있어 건너뛴 항목 ' + num(d.skipped) + '개');
            if (d.images) lines.push('이미지 ' + num(d.images) + '개');
            if (d.backup) lines.push('\n가져오기 전 DB 백업: ' + d.backup);
            PB.alert(p.label + ' 가져오기', lines.join('\n'), 'success');
            loadPacks();
            loadBackups();
        });
    }
    function packAction(kind, act) {
        var p = packs.filter(function (x) { return x.kind === kind; })[0];
        if (act === 'export') {
            var pick = kind === 'templates' ? pickGroups({
                title: '내보낼 스타일', text: '고른 스타일의 템플릿을 파일(.zip) 하나에 담습니다.', confirmText: '내보내기',
                items: (p.styles || []).map(function (s) { return {key: s.id, label: s.label, count: s.count}; })})
                : kind === 'elements' ? pickGroups({
                    title: '내보낼 요소 종류', text: '고른 종류의 프롬프트 요소를 파일(.zip) 하나에 담습니다.', confirmText: '내보내기',
                    items: (p.types || []).map(function (t) { return {key: t.key, label: t.label, count: t.count}; })})
                : Promise.resolve(undefined);
            pick.then(function (groups) {
                if (groups === null) return;
                setPackBusy(kind + ':export');
                PB.api('/api/data/export', groupBody(kind, {kind: kind}, groups)).then(function (d) {
                    setPackBusy('');
                    if (!d.ok) return PB.toast(d.message, 'error');
                    if (d.cancelled) return;
                    PB.dialog({title: p.label + '을(를) 내보냈습니다', icon: 'success', confirmText: '' + PB.fileManager + '에서 보기', cancelText: '닫기',
                        text: d.name + '\n' + num(d.count) + '개' + (d.images ? ' · 이미지 ' + num(d.images) + '개' : '') + ' · ' + fmtSize(d.size)}).then(function (r) {
                        if (r.isConfirmed) PB.api('/api/data/reveal', {path: d.path});
                    });
                });
            });
        } else if (act === 'import' && (kind === 'templates' || kind === 'elements')) {
            // 템플릿 · 프롬프트 요소는 파일을 먼저 열어 본 뒤 가져올 스타일 · 종류를 고른다
            setPackBusy(kind + ':import');
            PB.api('/api/data/inspect', {kind: kind}).then(function (d) {
                setPackBusy('');
                if (!d.ok) return PB.alert('가져오지 못했습니다', d.message, 'error');
                if (d.cancelled) return;
                var o = kind === 'templates'
                    ? {title: '가져올 스타일', text: d.name + '\n템플릿 ' + num(d.count) + '개 · 스타일 ' + num((d.styles || []).length) + '개',
                        items: (d.styles || []).map(function (s) { return {key: s.label, label: s.label, count: s.count, note: s.exists ? '' : '새 스타일'}; })}
                    : {title: '가져올 요소 종류', text: d.name + '\n프롬프트 요소 ' + num(d.count) + '개 · 종류 ' + num((d.types || []).length) + '개',
                        items: (d.types || []).map(function (t) { return {key: t.key, label: t.label, count: t.count}; })};
                o.confirmText = '가져오기';
                pickGroups(o).then(function (groups) {
                    if (groups !== null) importPack(p, kind, d.path, groups);
                });
            });
        } else if (act === 'import') {
            importPack(p, kind);
        } else if (act === 'clear') {
            var what = num(p.count) + '개' + (kind === 'templates' ? '와 스타일 ' + num(p.extra) + '개' : '');
            var text = p.label + ' ' + what + '를 DB에서 지웁니다.' + (p.images ? '\n이미지 ' + num(p.images) + '개(' + fmtSize(p.size) + ')는 휴지통으로 보냅니다.' : '') +
                '\n\n비우기 전에 DB를 자동으로 백업합니다. 먼저 내보내 두면 그대로 다시 가져올 수 있습니다.';
            PB.confirm(p.label + '을(를) 모두 비울까요?', text, {confirmText: '비우기', danger: true}).then(function (ok) {
                if (!ok) return;
                setPackBusy(kind + ':clear');
                PB.api('/api/data/clear', {kind: kind}).then(function (d) {
                    setPackBusy('');
                    if (!d.ok) return PB.alert('비우지 못했습니다', d.message, 'error');
                    PB.toast(p.label + ' ' + num(d.removed) + '개를 비웠습니다' + (d.images ? ' · 이미지 ' + num(d.images) + '개 ' + (d.where === 'trash' ? '휴지통으로' : 'backups 폴더로') : '') + '.');
                    loadPacks();
                    loadBackups();
                });
            });
        }
    }
    function restartApp() {
        PB.api('/api/app/restart', {}).then(function (d) {
            if (!d.ok) return PB.alert('다시 시작하세요', d.message, 'info');
            document.body.innerHTML = '<div class="restarting"><span class="spinner"></span><b>다시 시작하는 중…</b><span>데이터를 옮긴 뒤 곧 다시 열립니다.</span></div>';
        });
    }
    function requestMove(path, mode) {
        PB.api('/api/storage/change', {path: path, mode: mode || 'move'}).then(function (d) {
            if (!d || !d.ok) return PB.toast((d && d.message) || '위치를 바꾸지 못했습니다.', 'error');
            if (d.conflict) {
                return PB.dialog({title: '그 위치에 이미 데이터가 있습니다', icon: 'warning',
                    text: d.target + '\n\n이 위치의 LOOM 데이터로 바꿀까요? 지금 데이터는 원래 위치에 그대로 남습니다.',
                    confirmText: '그 데이터 사용'}).then(function (r) { if (r.isConfirmed) requestMove(d.target, 'use'); });
            }
            refreshStorage();
            var text = (d.mode === 'use' ? '이 위치의 데이터를 쓰도록 바꿉니다.' : '데이터 ' + fmtSize(d.size) + '를 옮깁니다.') + '\n→ ' + d.target + '\n\n앱을 다시 시작할 때 처리됩니다.';
            PB.dialog({title: '저장 위치를 바꿉니다', text: text, icon: 'info', confirmText: d.can_restart ? '지금 다시 시작' : '확인', cancelText: '나중에', cancel: !!d.can_restart}).then(function (r) {
                if (r.isConfirmed && d.can_restart) restartApp();
            });
        });
    }
    /* ---------- 도움말 ---------- */
    var HELP = [
        ['start', '시작하기', 'play', '<ol>' +
            '<li><b>ComfyUI 서버</b> 메뉴에 주소를 넣고 ‘연결 확인’을 누릅니다. 이 컴퓨터에서 켠 ComfyUI라면 <code>http://127.0.0.1:8188</code> 그대로 쓰면 됩니다.</li>' +
            '<li><b>Workflow</b> 메뉴에 ComfyUI 메뉴 <b>Workflow → Export (API)</b>로 저장한 JSON을 추가하고, 별표로 기본 workflow를 정합니다.</li>' +
            '<li><b>빌더</b>에서 템플릿과 항목을 고르고 오른쪽 도크의 <b>생성</b>(' + PB.kbd('mod', '↵') + ')을 누릅니다. 결과는 <b>갤러리</b>에 쌓입니다.</li></ol>'],
        ['builder', '빌더', 'wand', '<ul>' +
            '<li>1 템플릿 → 2 인물 → 3 의상·포즈 → 4 배경 → 5 카메라·LoRA 순서로 고릅니다. ' + PB.kbd('mod', '1') + '–<kbd>5</kbd>로 단계를 옮길 수 있어요.</li>' +
            '<li>고르는 즉시 오른쪽 도크에 Positive · Negative 프롬프트가 조합됩니다. 도크의 프롬프트를 직접 고치면 ‘직접 수정함’ 상태가 되고, <b>자동으로</b>를 누르면 다시 조합합니다.</li>' +
            '<li><b>추가 입력</b>은 Positive · Negative 끝에 덧붙일 내용입니다.</li>' +
            '<li>템플릿 목록 위 스타일 버튼으로 골라 보고(버튼의 숫자는 템플릿 수), 주사위는 보이는 템플릿 중 하나를, 템플릿의 <b>세부 랜덤</b>은 세부 항목을 무작위로 고릅니다.</li>' +
            '<li>템플릿 단계의 <b>초기화</b>는 고른 템플릿만 지웁니다. 템플릿 없이 인물·의상·배경만으로 조합하거나 프롬프트를 직접 쓸 때 쓰세요. 위쪽 <b>전체 초기화</b>는 모든 선택을 지웁니다.</li>' +
            '<li>생성: 서버 · workflow · 장 수 · 크기(W·H) · CFG · Steps를 고를 수 있고, seed는 매번 무작위입니다. ComfyUI가 꺼져 있으면 실패하지 않고 대기열에 남습니다.</li></ul>'],
        ['templates', '템플릿 만들기', 'layers', '<ul>' +
            '<li>Positive Prompt에 <code>{변수}</code>를 넣으면 빌더에서 고를 수 있는 세부 항목이 됩니다. 예: <code>a woman wearing {outfit}, {pose}</code></li>' +
            '<li><code>{이름:A|B|C}</code> 바로 고르기 패턴은 저장할 때 세부 항목으로 바뀝니다. 이름 없이 <code>{A|B}</code>도 됩니다.</li>' +
            '<li><b>Full Options</b>로 세부 항목을 한 번에 입력합니다. <code>{변수명} 표시 이름</code> 다음 줄부터 <code>표시 이름 | prompt</code>를 한 줄씩 적습니다.' +
            '<pre>{outfit} 복장\n화사한 니트 | a bright colorful knit sweater\n컬러 티셔츠 | a vivid colored t-shirt</pre></li>' +
            '<li><b>코드 저장 · 불러오기</b>는 제목 · 프롬프트 · 세부 항목을 텍스트 파일 하나로 주고받습니다.</li>' +
            '<li>썸네일은 파일, 생성 이미지에서 고르기, 끌어다 놓기로 넣고 500×500으로 잘라 저장합니다. ' + PB.kbd('mod', 'S') + '로 저장.</li>' +
            '<li>목록 위 <b>스타일 관리</b>에서 빌더의 스타일 목록을 추가 · 이름 바꾸기 · 삭제합니다. 이름 앞 숫자(예: 10. 풍경)로 순서를 정해요. 편집 화면의 스타일 목록에서 ‘새 스타일…’로 바로 만들 수도 있습니다.</li></ul>'],
        ['elements', '프롬프트 요소', 'sliders', '<ul>' +
            '<li>빌더의 인물 · 의상 · 포즈 · 카메라 단계에서 고르는 항목입니다. 왼쪽에서 종류를 고르면 그룹별로 보입니다.</li>' +
            '<li><b>요소 추가</b>나 그룹 옆 <b>+</b>로 바로 등록하고, 항목의 연필로 고치고, 휴지통으로 지웁니다. 빌더는 다시 열 때 바뀐 목록을 씁니다.</li>' +
            '<li>그룹은 빌더에 보이는 묶음입니다. 의상 · 악세사리 · 타투는 빌더의 그룹 구성이 정해져 있어 있는 그룹에만 넣을 수 있고, 나머지 종류는 새 그룹을 만들 수 있어요.</li>' +
            '<li><b>상위 항목</b>은 카메라 렌즈(카메라 바디), 악세사리 위치(카테고리) · 디자인(위치)처럼 앞 단계에 따라 목록을 거를 때 씁니다. 보통은 비워 둡니다.</li>' +
            '<li><b>사용</b>을 끄면 지우지 않고 빌더에서만 숨깁니다. 검색은 모든 종류에서 찾습니다.</li></ul>'],
        ['gallery', '갤러리', 'image', '<ul>' +
            '<li>위쪽 크기 막대로 미리보기를 50–250%로 자유롭게 키우고 줄입니다 (숫자를 누르면 100%). 목록은 작은 썸네일로 빨리 그리고, 크게 볼 때는 원본을 보여 줍니다. 이미지를 지우면 썸네일도 함께 지워집니다.</li>' +
            '<li>전체 · 실패를 나눠 보고, 프롬프트 · 템플릿 이름으로 검색합니다. 진행 중 작업과 대기 작업 목록이 맨 위에 보이고, 대기 작업은 하나씩 취소하거나 모두 취소할 수 있어요.</li>' +
            '<li>이미지마다 같은 설정으로 다시 생성, <b>빌더에서 열기</b>(그때의 선택값 복원), ' + PB.fileManager + '에서 보기, 삭제를 할 수 있어요. 크게 볼 때 <kbd>←</kbd><kbd>→</kbd>(처음 · 끝은 <kbd>Home</kbd><kbd>End</kbd>)로 넘기고, 아래쪽 썸네일 줄에서 바로 고릅니다. 썸네일 줄은 <kbd>T</kbd>로 숨기거나 다시 봅니다.</li>' +
            '<li>크게 볼 때 마우스 휠(트랙패드는 핀치)로 커서 자리를 확대 · 축소하고, 확대한 이미지는 끌어서 옮깁니다. 아래에 배율(%)과 이미지 실제 크기(픽셀)가 보여요. <kbd>+</kbd><kbd>−</kbd>로 확대 · 축소, <kbd>0</kbd>은 화면에 맞춤, <kbd>1</kbd>은 실제 크기(100%)이고, 이미지를 두 번 누르면 맞춤 ↔ 실제 크기로 바뀝니다.</li>' +
            '<li><b>선택</b>을 누르면 여러 장을 한 번에 지울 수 있습니다.</li></ul>'],
        ['data', '데이터 · 배포', 'database', '<ul>' +
            '<li><b>데이터</b> 메뉴에서 템플릿(스타일 포함) · 프롬프트 요소 · 의상 프리셋 · 유명 배경을 종류별로 <b>내보내기 · 가져오기 · 비우기</b> 합니다. 썸네일 · 미리보기 이미지도 함께 옮겨집니다.</li>' +
            '<li>템플릿은 <b>스타일별로</b>, 프롬프트 요소는 <b>종류별로</b>(인물 · 메이크업 · 헤어 · 의상 · 포즈 · 악세사리 · 타투 · 카메라 · 렌더링 품질 · 배경 옵션) 옮길 수 있습니다. 내보내기를 누르면 담을 것을, 가져오기에서 파일을 고르면 그 안에서 가져올 것을 고릅니다 (처음엔 전체가 골라져 있어요).</li>' +
            '<li>가져오기는 지금 데이터에 더합니다. 템플릿 제목이 이미 있으면 ‘제목 (1)’, ‘제목 (2)’…로, 스타일은 이름이 같으면 이미 있는 스타일을 씁니다. 프롬프트 요소 · 의상 · 유명 배경은 같은 항목이 있으면 건너뜁니다.</li>' +
            '<li>비우기는 DB에서 지우고 이미지는 휴지통으로 보냅니다. 가져오기 · 비우기 전에는 DB를 자동으로 backups 폴더에 백업합니다.</li>' +
            '<li>앱은 빈 상태로 시작합니다. 따로 받은 템플릿 · 프롬프트 요소 · 의상 프리셋 · 유명 배경 파일(.zip)을 풀지 말고 같은 화면의 <b>가져오기</b>로 넣으세요. workflow 묶음은 풀어서 JSON 파일들을 <b>Workflow</b> 메뉴에 한꺼번에 끌어다 놓으면 됩니다.</li>' +
            '<li><b>백업 · 복원</b>은 DB 전체를 통째로 저장하고 되돌립니다 (이미지 파일 제외). <b>위치 변경…</b>으로 저장 위치를 바꾸면 앱을 다시 시작할 때 데이터를 옮깁니다.</li></ul>'],
        ['trouble', '문제 해결', 'alert', '<ul>' +
            '<li><b>ComfyUI 연결 안 됨</b>: ComfyUI가 켜져 있는지, 주소와 포트가 맞는지 확인하세요. 다른 컴퓨터의 ComfyUI는 그 컴퓨터에서 <code>--listen</code>으로 실행해야 합니다.</li>' +
            '<li>workflow에 <b>프롬프트 자리 없음</b>이 보이면: API 형식 JSON인지, <code>{{positive}}</code> 자리나 CLIPTextEncode 노드가 있는지 확인하세요.</li>' +
            '<li>결과가 오지 않고 실패하면 <b>ComfyUI 서버</b> 메뉴의 결과 대기 시간을 늘려 보세요.</li>' +
            '<li>기록(로그): <code>' + esc((B.paths || {}).log || '') + '</code></li></ul>']
    ];
    function helpCard() {
        return '<section class="card set-card help-doc" id="help"><div class="card-title">' + icon('help') + '<span>도움말</span><span class="sub">LOOM 쓰는 법</span></div>' +
            '<nav class="help-toc">' + HELP.map(function (h) { return '<button type="button" class="chip" data-help-go="' + h[0] + '">' + esc(h[1]) + '</button>'; }).join('') + '</nav>' +
            HELP.map(function (h) { return '<div class="help-topic" data-help="' + h[0] + '"><h3>' + icon(h[2]) + esc(h[1]) + '</h3>' + h[3] + '</div>'; }).join('') +
            '</section>';
    }

    // 브랜드 문구 · 링크는 pb/brand.py 한 곳에서 온다 (앱 메뉴의 'LOOM 정보' 창과 같다)
    function aboutCard() {
        var br = B.brand || {};
        var v = B.version ? ' <span class="chip">v' + esc(B.version) + '</span>' : '';
        return '<section class="card set-card" id="about"><div class="card-title">' + icon('info') + '<span>정보</span></div>' +
            '<div class="about"><img src="/static/img/icon-256.png" alt=""><div><b><span class="about-name">' + esc(br.name) + '</span>' + v + '</b><span>' + esc(br.product) + ' · 웹 연동 없이 이 컴퓨터에서만 동작</span></div></div>' +
            '<div class="about-slogan"><b>' + esc(br.slogan) + '</b><span>' + esc(br.sloganEn) + '</span></div>' +
            '<dl class="kv about-kv about-parts">' + (br.parts || []).map(function (p) {
                return '<dt>' + esc(p.en) + ' <small>' + esc(p.ko) + '</small></dt><dd>' + esc(p.text) + '</dd>';
            }).join('') + '</dl>' +
            '<p class="about-intro">' + esc(br.intro) + '</p>' +
            '<dl class="kv about-kv">' +
            '<dt>제작자</dt><dd>' + esc(br.author) + '</dd>' +
            (br.links || []).map(function (l) {
                return '<dt>' + esc(l.label) + '</dt><dd><a class="link" href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.short) + '</a></dd>';
            }).join('') +
            '</dl>' +
            '<div class="section-title">단축키</div>' +
            '<div class="keys"><div>' + PB.kbd('mod', '↵') + '<span>생성</span></div><div>' + PB.kbd('mod', '1') + '–<kbd>5</kbd><span>빌더 단계 이동</span></div>' +
            '<div>' + PB.kbd('mod', 'B') + ' ' + PB.kbd('mod', 'G') + ' ' + PB.kbd('mod', 'T') + ' ' + PB.kbd('mod', 'E') + '<span>빌더 · 갤러리 · 템플릿 · 요소</span></div><div>' + PB.kbd('mod', 'S') + '<span>템플릿 저장</span></div>' +
            '<div>' + PB.kbd('mod', ',') + '<span>ComfyUI 서버</span></div><div>' + PB.kbd('mod', 'D') + '<span>데이터</span></div>' +
            '<div><kbd>←</kbd><kbd>→</kbd><span>갤러리 · 피커에서 이전/다음</span></div><div>' + PB.helpKey + '<span>사용법 (도움말)</span></div></div>' +
            '<div class="copyright">' + esc(br.copyright) + '</div></section>';
    }

    /* ---------- 동작 ---------- */
    function refreshWorkflows() {
        return PB.api('/api/settings/data').then(function (boot) {
            if (!boot || !boot.ok) return;
            workflows = boot.workflows || [];
            loras = boot.loras || [];
            cfg = boot.settings || cfg;
            render();
            loadBackups();
        });
    }
    function pingAll() {
        $$('[data-srv]').forEach(function (inp) { if (inp.value.trim()) ping(parseInt(inp.getAttribute('data-srv'), 10)); });
    }
    function ping(i) {
        var inp = $('[data-srv="' + i + '"]'), out = $('[data-state="' + i + '"]');
        var url = inp.value.trim();
        if (!url) return;
        if (!/^https?:\/\//.test(url)) url = 'http://' + url;
        out.className = 'srv-state';
        out.innerHTML = '<span class="spinner"></span>';
        PB.api('/api/comfy/ping', {url: url.replace(/\/+$/, '')}).then(function (d) {
            if (d && d.ok) {
                out.className = 'srv-state is-ok';
                out.textContent = '연결됨 · ' + [d.device, d.vram_gb ? d.vram_gb + 'GB' : '', d.version ? 'v' + d.version : '', d.ms + 'ms'].filter(Boolean).join(' · ');
            } else {
                out.className = 'srv-state is-bad';
                out.textContent = (d && d.message) || '연결할 수 없습니다';
            }
        });
    }
    function uploadFiles(files) {
        files = Array.prototype.slice.call(files || []).filter(function (f) { return /\.json$/i.test(f.name) || f.type === 'application/json'; });
        if (!files.length) return PB.toast('JSON 파일을 골라 주세요.', 'warn');
        var done = 0, ok = 0;
        files.forEach(function (f) {
            var r = new FileReader();
            r.onload = function () {
                PB.api('/api/workflows/upload', {file_name: f.name, text: r.result}).then(function (d) {
                    done++;
                    if (d && d.ok) ok++; else PB.toast(f.name + ': ' + ((d && d.message) || '추가 실패'), 'error');
                    if (done === files.length) { if (ok) PB.toast(ok + '개 workflow를 추가했습니다.'); refreshWorkflows(); }
                });
            };
            r.readAsText(f, 'utf-8');
        });
    }

    document.addEventListener('click', function (e) {
        var t = e.target;
        var pg = t.closest('[data-ping]');
        if (pg) return ping(parseInt(pg.getAttribute('data-ping'), 10));
        if (t.closest('#saveServer')) {
            var servers = $$('[data-srv]').map(function (i) { return i.value.trim(); }).filter(Boolean);
            PB.api('/api/settings', {comfy_servers: servers, timeout_minutes: parseInt($('#setTimeout').value, 10) || 10}).then(function (d) {
                if (!d.ok) return PB.toast(d.message, 'error');
                cfg = d.settings;
                render();
                pingAll();
                PB.refreshJobs();
                PB.toast('서버 설정을 저장했습니다.');
            });
            return;
        }
        var op = t.closest('[data-open]');
        if (op) return PB.api('/api/data/open', {which: op.getAttribute('data-open')});
        if (t.closest('#wfDrop')) return $('#wfFile').click();
        var wfRow = t.closest('[data-wf]');
        if (wfRow) {
            var id = wfRow.getAttribute('data-wf');
            var wf = workflows.filter(function (w) { return w.id === id; })[0];
            if (t.closest('[data-wf-default]')) {
                PB.api('/api/settings', {default_workflow_id: cfg.default_workflow_id === id ? '' : id}).then(function (d) { cfg = d.settings; render(); });
            } else if (t.closest('[data-wf-rename]')) {
                PB.promptText('workflow 이름 바꾸기', wf.name).then(function (name) {
                    if (!name || name === wf.name) return;
                    PB.api('/api/workflows/rename', {id: id, name: name}).then(function (d) {
                        if (!d.ok) return PB.toast(d.message, 'error');
                        if (cfg.default_workflow_id === id) PB.api('/api/settings', {default_workflow_id: d.id});
                        refreshWorkflows();
                    });
                });
            } else if (t.closest('[data-wf-delete]')) {
                PB.confirm('‘' + wf.name + '’을(를) 삭제할까요?', 'workflow 파일을 지웁니다. 이 workflow로 대기 중인 작업은 실패합니다.', {confirmText: '삭제', danger: true}).then(function (ok) {
                    if (ok) PB.api('/api/workflows/delete', {id: id}).then(function (d) { if (!d.ok) PB.toast(d.message, 'error'); refreshWorkflows(); });
                });
            }
            return;
        }
        if (t.closest('#loraAdd')) { editingLora = {idx: 0, title: '', filename: '', support_type: '', default_strength: 1, trigger_text: '', url: '', description: '', is_active: 1}; render(); $('#loraForm [data-lf="filename"]').focus(); return; }
        if (t.closest('#loraCancel')) { editingLora = null; render(); return; }
        if (t.closest('#loraSave')) {
            var data = {idx: parseInt(t.closest('#loraSave').getAttribute('data-idx'), 10) || 0};
            $$('#loraForm [data-lf]').forEach(function (i) { data[i.getAttribute('data-lf')] = i.type === 'checkbox' ? i.checked : i.value; });
            PB.api('/api/lora/save', data).then(function (d) {
                if (!d.ok) return PB.toast(d.message, 'error');
                editingLora = null;
                PB.toast('LoRA를 저장했습니다.');
                refreshWorkflows();
            });
            return;
        }
        var li = t.closest('.lora-item');
        if (li) {
            var idx = parseInt(li.getAttribute('data-idx'), 10);
            var l = loras.filter(function (x) { return x.idx === idx; })[0];
            if (t.closest('[data-lora-edit]')) { editingLora = l; render(); $('#loraForm').scrollIntoView({block: 'nearest'}); }
            if (t.closest('[data-lora-del]')) {
                PB.confirm('‘' + l.title + '’ LoRA를 삭제할까요?', '목록에서만 지웁니다 (LoRA 파일은 그대로).', {confirmText: '삭제', danger: true}).then(function (ok) {
                    if (ok) PB.api('/api/lora/delete', {idx: idx}).then(refreshWorkflows);
                });
            }
            return;
        }
        var pk = t.closest('[data-pack]');
        if (pk && !pk.disabled) return packAction(pk.closest('[data-kind]').getAttribute('data-kind'), pk.getAttribute('data-pack'));
        var hg = t.closest('[data-help-go]');
        if (hg) { var topic = $('[data-help="' + hg.getAttribute('data-help-go') + '"]'); if (topic) topic.scrollIntoView({behavior: 'smooth', block: 'start'}); return; }
        if (t.closest('#stChange')) {
            PB.api('/api/storage/choose', {start: store.data_dir}).then(function (d) {
                if (d && d.ok && d.path) requestMove(d.path, 'move');
                else if (d && d.ok && !d.path) {
                    PB.promptText('새 저장 위치', store.default_dir, {text: '폴더 경로를 입력하세요. 비어 있지 않은 폴더를 고르면 그 안에 ‘LOOM’ 폴더를 만듭니다.', confirmText: '다음'}).then(function (p) { if (p) requestMove(p, 'move'); });
                }
            });
            return;
        }
        if (t.closest('#stDefault')) return requestMove(store.default_dir, 'move');
        if (t.closest('#stRestart')) return restartApp();
        if (t.closest('#stCancel')) return PB.api('/api/storage/cancel', {}).then(refreshStorage);
        if (t.closest('#stClearError')) return PB.api('/api/storage/clear-error', {}).then(refreshStorage);
        if (t.closest('#backupNow')) {
            PB.api('/api/data/backup', {}).then(function (d) {
                if (!d.ok) return PB.toast(d.message, 'error');
                PB.toast('백업했습니다 · ' + d.name);
                loadBackups();
            });
            return;
        }
        var bk = t.closest('[data-backup]');
        if (bk) {
            var name = bk.getAttribute('data-backup');
            if (t.closest('[data-restore]')) {
                PB.confirm('이 백업으로 복원할까요?', name + '\n지금 DB는 복원 전에 자동으로 백업됩니다.', {confirmText: '복원', danger: true}).then(function (ok) {
                    if (!ok) return;
                    PB.api('/api/data/restore', {name: name}).then(function (d) {
                        if (!d.ok) return PB.toast(d.message, 'error');
                        PB.toast('복원했습니다.');
                        setTimeout(function () { location.reload(); }, 800);
                    });
                });
            }
            if (t.closest('[data-backup-del]')) {
                PB.confirm('백업 파일을 삭제할까요?', name, {confirmText: '삭제', danger: true}).then(function (ok) {
                    if (ok) PB.api('/api/data/backup-delete', {name: name}).then(loadBackups);
                });
            }
        }
    });
    document.addEventListener('change', function (e) {
        if (e.target.id === 'wfFile') { uploadFiles(e.target.files); e.target.value = ''; }
    });
    document.addEventListener('dragover', function (e) {
        var d = e.target.closest && e.target.closest('#wfDrop');
        if (d) { e.preventDefault(); d.classList.add('is-over'); }
    });
    document.addEventListener('dragleave', function (e) {
        var d = e.target.closest && e.target.closest('#wfDrop');
        if (d) d.classList.remove('is-over');
    });
    document.addEventListener('drop', function (e) {
        var d = e.target.closest && e.target.closest('#wfDrop');
        if (!d) return;
        e.preventDefault();
        d.classList.remove('is-over');
        uploadFiles(e.dataTransfer.files);
    });

    function loadBackups() {
        PB.api('/api/data/backups').then(function (d) {
            var box = $('#backupList');
            if (!box) return;
            var items = (d && d.items) || [];
            box.innerHTML = items.length ? items.map(function (b) {
                return '<div class="backup-item" data-backup="' + esc(b.name) + '">' + icon('database') + '<span class="backup-name">' + esc(b.name) + '</span>' +
                    '<span class="faint">' + esc(b.modified) + ' · ' + (b.size / 1048576).toFixed(1) + 'MB</span>' +
                    '<button type="button" class="btn btn-sm" data-restore>' + icon('undo') + '복원</button>' +
                    '<button type="button" class="icon-btn sm" data-backup-del title="삭제">' + icon('trash') + '</button></div>';
            }).join('') : '<div class="faint">아직 백업이 없습니다.</div>';
        });
    }

    CARDS = {server: serverCard, workflows: workflowCard, lora: loraCard, data: dataCard, help: helpCard, about: aboutCard};
    showSection();
})();
