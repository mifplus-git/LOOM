/* LOOM — 빌더 화면
   선택값은 모두 state 하나에 모으고, 바뀔 때마다 프롬프트를 다시 조합해 오른쪽 도크에 보여 준다. */
(function () {
    'use strict';
    var PB = window.PB, B = window.PB_BOOT || {};
    var esc = PB.esc, icon = PB.icon;

    function $(sel, root) { return (root || document).querySelector(sel); }
    function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

    /* ================================================================ 데이터 색인 */
    var EL = {};          // 요소 id → {label, prompt}
    function indexGroups(groups) {
        (groups || []).forEach(function (g) { g.items.forEach(function (it) { EL[it.id] = it; }); });
    }
    ['person', 'makeup', 'hair'].forEach(function (k) { indexGroups((B.person || {})[k]); });
    indexGroups(B.outfit); indexGroups(B.pose); indexGroups(B.camera); indexGroups(B.render);
    (B.accessory || []).concat(B.tattoo || []).forEach(function (s) { s.items.forEach(function (it) { EL[it.id] = it; }); });
    var LORA = {};
    (B.loras || []).forEach(function (l) { LORA[l.id] = l; });
    var WF = {};
    (B.workflows || []).forEach(function (w) { WF[w.id] = w; });
    var TPL = {};
    (B.templates || []).forEach(function (t) { TPL[t.id] = t; });
    var tplCache = {};

    /* ================================================================ 상태 */
    function blankState() {
        return {
            v: 2,
            tab: 'template',
            template: null,                     // {id}
            slots: {},                          // slotKey → 옵션 번호, -1 = 선택 안 함
            tplFilter: {style: '', q: '', sort: 'name'},
            person: {age: '', sel: {}},         // 'person|피부톤' → 요소 id
            outfit: {mode: 'preset', preset: null, kind: '', sel: {}},
            pose: {},
            accessories: [], tattoos: [],
            place: null,
            placeSlots: {},                     // slotKey → 옵션 번호, -1 = 선택 안 함
            camera: {art: '', sel: {}},
            render: {on: true, sel: {}, extra: ''},
            lora: {sel: {}, tpl: {}},           // sel: loraId → 강도, tpl: 이름 → {strength, off}
            extra: {pos: '', neg: ''},
            manual: {pos: null, neg: null},
            gen: {server: '', workflow: '', width: '', height: '', cfg: '', steps: '', count: 1, wfLora: {}}
        };
    }
    function mergeState(saved) {
        var s = blankState();
        if (!saved || typeof saved !== 'object' || saved.v !== 2) return s;
        Object.keys(s).forEach(function (k) {
            if (saved[k] === undefined) return;
            if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && saved[k] && typeof saved[k] === 'object' && !Array.isArray(saved[k])) {
                s[k] = Object.assign(s[k], saved[k]);
            } else {
                s[k] = saved[k];
            }
        });
        return s;
    }
    var S = mergeState(B.state);
    var saveState = PB.debounce(function () { PB.api('/api/state', {state: S}); }, 400);

    /* ================================================================ 프롬프트 조합 */
    function clean(text) {
        text = String(text || '');
        text = text.replace(/[\r\n]+/g, ', ');
        text = text.replace(/\s*,\s*/g, ', ');
        text = text.replace(/(?:,\s*){2,}/g, ', ');
        text = text.replace(/^\s*,\s*/g, '').replace(/\s*,\s*$/g, '');
        text = text.replace(/\s{2,}/g, ' ');
        return text.trim();
    }
    function fmtStrength(v) {
        var n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
        if (!Number.isFinite(n)) n = 1;
        return Math.max(0, Math.min(2, n)).toFixed(2);
    }
    function loraName(v) {
        return String(v || '').trim().split(/[\\/]/).pop().replace(/\.(safetensors|ckpt|pt)$/i, '').toLowerCase();
    }
    function loraTags(text) {
        var out = [], re = /<lora:([^:>]+)(?::([^>]+))?>/gi, m;
        while ((m = re.exec(String(text || ''))) !== null) out.push({raw: m[0], name: loraName(m[1]), file: m[1], strength: fmtStrength(m[2] || 1)});
        return out;
    }
    function setTagStrength(text, strength) {
        return String(text || '').replace(/<lora:([^:>]+)(?::[^>]+)?>/i, '<lora:$1:' + fmtStrength(strength) + '>');
    }
    function slotValue(slots, slot, idx) {
        var opts = activeOptions(slot);
        if (idx === undefined || idx === null) idx = defaultSlotIndex(slot);
        idx = parseInt(idx, 10);
        return (idx >= 0 && opts[idx]) ? opts[idx].value_prompt || '' : '';
    }
    function activeOptions(slot) {
        return (slot && slot.options || []).filter(function (o) { return String(o.is_active) !== '0'; });
    }
    function defaultSlotIndex(slot) {
        var opts = activeOptions(slot);
        if (!opts.length) return -1;
        for (var i = 0; i < opts.length; i++) if (String(opts[i].is_default) === '1') return i;
        return 0;
    }
    function replaceVars(text, map) {
        Object.keys(map).forEach(function (k) {
            var safe = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            text = text.replace(new RegExp('\\{' + safe + '\\}', 'g'), map[k]);
        });
        return text;
    }
    function templateLoraEntries(t) {
        // 템플릿에 딸린 LoRA: base_prompt 안의 <lora:> 태그 + 템플릿 lora JSON
        var entries = {};
        loraTags(t.base_prompt).forEach(function (tag) { entries[tag.name] = {name: tag.name, file: tag.file, strength: tag.strength, trigger: ''}; });
        var raw = String(t.lora || '').trim();
        if (raw) {
            try {
                var parsed = JSON.parse(raw);
                (Array.isArray(parsed) ? parsed : [parsed]).forEach(function (item) {
                    var p = typeof item === 'string' ? item : (item && (item.prompt || item.lora_prompt)) || '';
                    var tags = loraTags(p);
                    if (!tags.length) return;
                    var trigger = clean(p.replace(/<lora:[^>]+>/gi, ''));
                    tags.forEach(function (tag) { entries[tag.name] = {name: tag.name, file: tag.file, strength: tag.strength, trigger: trigger}; });
                });
            } catch (e) {
                loraTags(raw).forEach(function (tag) { entries[tag.name] = {name: tag.name, file: tag.file, strength: tag.strength, trigger: ''}; });
            }
        }
        return Object.keys(entries).map(function (k) { return entries[k]; });
    }
    function currentTemplate() {
        return S.template ? tplCache[S.template.id] || null : null;
    }
    function selPrompts(groups, prefix, selMap) {
        var out = [];
        (groups || []).forEach(function (g) {
            var id = selMap[(prefix ? prefix + '|' : '') + g.label];
            if (id && EL[id]) out.push(EL[id].prompt);
        });
        return out;
    }
    function renderDefaultId(g) { return g.items[0] ? g.items[0].id : 0; }

    function composeParts() {
        var parts = {};
        var t = currentTemplate();
        var tplText = '', tplNeg = '';
        var loraOut = [], seen = {};
        // LoRA (직접 고른 것)
        Object.keys(S.lora.sel).forEach(function (id) {
            var l = LORA[id];
            if (!l) return;
            loraOut.push(setTagStrength(l.prompt, S.lora.sel[id]));
            loraTags(l.prompt).forEach(function (tag) { seen[tag.name] = true; });
        });
        if (t) {
            var map = {};
            (t.slots || []).forEach(function (slot) {
                var key = slot.slot_key || slot.label_ko;
                map[key] = slotValue(S.slots, slot, S.slots[key]);
            });
            tplText = replaceVars(String(t.base_prompt || ''), map).replace(/<lora:[^>]+>/gi, '');
            tplNeg = replaceVars(String(t.negative_prompt || ''), map);
            templateLoraEntries(t).forEach(function (e) {
                if (seen[e.name]) return;
                var o = S.lora.tpl[e.name] || {};
                if (o.off) return;
                loraOut.push('<lora:' + e.file + ':' + fmtStrength(o.strength != null ? o.strength : e.strength) + '>' + (e.trigger ? ', ' + e.trigger : ''));
            });
        }
        parts.lora = loraOut.join(', ');
        parts.camera = [S.camera.art].concat(selPrompts(B.camera, '', S.camera.sel)).filter(Boolean).join(', ');
        var person = [];
        var age = String(S.person.age || '').trim();
        if (age) person.push(/^\d+$/.test(age) ? age + ' years old' : age);
        ['person', 'makeup', 'hair'].forEach(function (k) { person = person.concat(selPrompts((B.person || {})[k], k, S.person.sel)); });
        parts.person = person.join(', ');
        parts.template = tplText;
        if (S.outfit.mode === 'preset') {
            parts.outfit = S.outfit.preset ? S.outfit.preset.prompt : '';
        } else {
            parts.outfit = S.outfit.kind ? selPrompts(B.outfit.filter(function (g) { return g.modes.indexOf(S.outfit.kind) !== -1; }), '', S.outfit.sel).join(', ') : '';
        }
        parts.pose = selPrompts(B.pose, '', S.pose).join(', ');
        parts.accessory = S.accessories.concat(S.tattoos).map(function (i) { return i.prompt; }).join(', ');
        if (S.place) {
            var smap = {};
            (B.placeSlots || []).forEach(function (slot) {
                var idx = S.placeSlots[slot.key];
                if (idx === undefined) idx = placeSlotDefault(slot);
                idx = parseInt(idx, 10);
                smap[slot.key] = idx >= 0 && slot.options[idx] ? slot.options[idx].prompt : '';
            });
            parts.background = replaceVars(S.place.prompt || '', smap);
        } else {
            parts.background = '';
        }
        if (S.render.on) {
            var r = [];
            (B.render || []).forEach(function (g) {
                var id = S.render.sel[g.label];
                if (id === undefined) id = renderDefaultId(g);
                if (id && EL[id]) r.push(EL[id].prompt);
            });
            if (S.render.extra) r.push(S.render.extra);
            parts.render = r.join(', ');
        } else {
            parts.render = '';
        }
        Object.keys(parts).forEach(function (k) { parts[k] = clean(parts[k]); });
        parts._neg = clean(tplNeg);
        return parts;
    }
    function placeSlotDefault(slot) {
        for (var i = 0; i < slot.options.length; i++) if (String(slot.options[i].is_default) === '1') return i;
        return 0;
    }
    var ORDER = ['lora', 'camera', 'person', 'template', 'outfit', 'pose', 'accessory', 'background', 'render'];
    var PIECE_LABEL = {lora: 'LoRA', camera: '카메라', person: '인물', template: '템플릿', outfit: '의상', pose: '포즈', accessory: '악세사리·타투', background: '배경', render: '품질'};
    var PIECE_TAB = {lora: 'camera', camera: 'camera', person: 'person', template: 'template', outfit: 'outfit', pose: 'outfit', accessory: 'outfit', background: 'background', render: 'camera'};
    var lastAuto = {pos: '', neg: ''};
    function autoPrompts() {
        var p = composeParts();
        var pos = ORDER.map(function (k) { return p[k]; }).filter(Boolean);
        if (S.extra.pos) pos.push(S.extra.pos);
        var neg = [p._neg];
        if (S.extra.neg) neg.push(S.extra.neg);
        return {parts: p, pos: clean(pos.join(', ')), neg: clean(neg.join(', '))};
    }

    /* ================================================================ 갱신 */
    var posOut = $('#posOut'), negOut = $('#negOut');
    function update(opts) {
        opts = opts || {};
        var a = autoPrompts();
        var changed = a.pos !== lastAuto.pos || a.neg !== lastAuto.neg;
        lastAuto = {pos: a.pos, neg: a.neg};
        var pos = S.manual.pos != null ? S.manual.pos : a.pos;
        var neg = S.manual.neg != null ? S.manual.neg : a.neg;
        if (document.activeElement !== posOut || S.manual.pos == null) { if (posOut.value !== pos) posOut.value = pos; }
        if (document.activeElement !== negOut || S.manual.neg == null) { if (negOut.value !== neg) negOut.value = neg; }
        var manual = S.manual.pos != null || S.manual.neg != null;
        var stale = manual && ((S.manual.pos != null && S.manual.pos !== a.pos) || (S.manual.neg != null && S.manual.neg !== a.neg));
        $('#promptMode').textContent = manual ? '직접 수정함' : '자동 조합';
        $('#promptMode').classList.toggle('is-manual', manual);
        var rev = $('#promptRevert');
        rev.hidden = !manual;
        rev.classList.toggle('is-attention', !!(stale && changed && opts.fromSelection));
        $('#posCount').textContent = pos ? (pos.split(',').filter(function (x) { return x.trim(); }).length + '개 항목') : '';
        renderPieces(a.parts);
        renderStepDots(a.parts);
        $('#copyPos').disabled = !pos;
        $('#copyNeg').disabled = !neg;
        $('#resetAllBtn').disabled = !hasAnything(a.parts);
        var ex = [S.extra.pos ? 'Positive' : '', S.extra.neg ? 'Negative' : ''].filter(Boolean).join(' · ');
        $('#extraHint').textContent = ex ? '· ' + ex : '';
        updateGenButton();
        if (!opts.noSave) saveState();
    }
    function hasAnything(p) {
        return !!(S.template || p.person || p.outfit || p.pose || p.accessory || p.background || p.camera || p.lora ||
            S.extra.pos || S.extra.neg || S.manual.pos != null || !S.render.on || Object.keys(S.render.sel).length || S.render.extra);
    }
    function renderPieces(p) {
        var html = ORDER.filter(function (k) { return p[k] && k !== 'render'; }).map(function (k) {
            var n = p[k].split(',').filter(function (x) { return x.trim(); }).length;
            return '<button type="button" class="piece" data-goto="' + PIECE_TAB[k] + '" title="' + esc(p[k]) + '">' + esc(PIECE_LABEL[k]) + '<span>' + n + '</span></button>';
        }).join('');
        $('#pieceChips').innerHTML = html || '<span class="faint">아직 고른 항목이 없습니다.</span>';
    }
    function renderStepDots(p) {
        var on = {
            template: !!S.template,
            person: !!p.person,
            outfit: !!(p.outfit || p.pose || p.accessory),
            background: !!p.background,
            camera: !!(p.camera || p.lora || !S.render.on || Object.keys(S.render.sel).length || S.render.extra)
        };
        $$('#steps .step').forEach(function (b) { b.classList.toggle('has-content', !!on[b.getAttribute('data-tab')]); });
    }

    /* ================================================================ 탭 */
    function setTab(tab) {
        if (!$('[data-panel="' + tab + '"]')) tab = 'template';
        S.tab = tab;
        $$('#steps .step').forEach(function (b) {
            var on = b.getAttribute('data-tab') === tab;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        $$('.builder-tab-panel').forEach(function (p) { p.classList.toggle('is-active', p.getAttribute('data-panel') === tab); });
        $('#builderContent').scrollTop = 0;
        saveState();
    }
    $('#steps').addEventListener('click', function (e) {
        var b = e.target.closest('.step');
        if (b) setTab(b.getAttribute('data-tab'));
    });
    document.addEventListener('click', function (e) {
        var g = e.target.closest('[data-goto]');
        if (g) { setTab(g.getAttribute('data-goto')); if (window.innerWidth <= 1280) $('#app').classList.remove('dock-open'); }
    });

    /* ================================================================ 공용 그리기 도구 */
    function selRow(label, bind, key, items, current, noneLabel) {
        var has = current !== '' && current != null && String(current) !== '0';
        var opts = '<option value="">' + esc(noneLabel || '선택 안 함') + '</option>' + items.map(function (it) {
            return '<option value="' + esc(it.id) + '"' + (String(it.id) === String(current) ? ' selected' : '') + '>' + esc(it.label) + '</option>';
        }).join('');
        return '<label class="sel-row"><span class="sel-label">' + esc(label) + '</span>' +
            '<select class="input ' + (has ? 'is-set' : 'is-unset') + '" data-bind="' + bind + '" data-key="' + esc(key) + '">' + opts + '</select></label>';
    }
    function cardHead(ic, title, opts) {
        opts = opts || {};
        return '<div class="card-title">' + icon(ic) + '<span>' + esc(title) + '</span>' +
            (opts.count ? '<span class="chip accent">' + opts.count + '</span>' : '') +
            '<div class="actions">' + (opts.actions || '') + '</div></div>';
    }
    function countSet(prefix, groups, map) {
        return (groups || []).filter(function (g) { return map[(prefix ? prefix + '|' : '') + g.label]; }).length;
    }
    function randomPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    // 모든 select[data-bind] 변경을 한곳에서 처리한다
    document.addEventListener('change', function (e) {
        var t = e.target;
        if (!t.matches || !t.matches('[data-bind]')) return;
        var bind = t.getAttribute('data-bind'), key = t.getAttribute('data-key'), v = t.value;
        var rerender = null;
        switch (bind) {
            case 'slot': S.slots[key] = v === '' ? -1 : parseInt(v, 10); break;
            case 'person': if (v) S.person.sel[key] = parseInt(v, 10); else delete S.person.sel[key]; rerender = 'person'; break;
            case 'outfitSel': if (v) S.outfit.sel[key] = parseInt(v, 10); else delete S.outfit.sel[key]; break;
            case 'outfitKind': S.outfit.kind = v; rerender = 'outfit'; break;
            case 'pose': if (v) S.pose[key] = parseInt(v, 10); else delete S.pose[key]; rerender = 'outfit'; break;
            case 'camera': if (v) S.camera.sel[key] = parseInt(v, 10); else delete S.camera.sel[key]; rerender = 'camera'; break;
            case 'art': S.camera.art = v; rerender = 'camera'; break;
            case 'render': S.render.sel[key] = v ? parseInt(v, 10) : 0; break;
            case 'placeSlot': S.placeSlots[key] = v === '' ? -1 : parseInt(v, 10); break;
            case 'cascade': onCascade(t); return;
            default: return;
        }
        if (t.tagName === 'SELECT') {
            var has = v !== '' && v !== '0' && v !== '-1';
            t.classList.toggle('is-set', has);
            t.classList.toggle('is-unset', !has);
        }
        if (rerender === 'person') refreshCardCounts();
        if (rerender === 'outfit') renderOutfit();
        if (rerender === 'camera') refreshCardCounts();
        update({fromSelection: true});
    });

    /* ================================================================ 1. 템플릿 */
    var tplGrid = $('#tplGrid'), tplDetail = $('#tplDetail');
    function buildTemplateGrid() {
        // 스타일 버튼: 이름 앞 정렬 번호(예: 51. )는 떼고 보여 준다. 없어진 스타일이 골라져 있으면 전체로
        var cur = String(S.tplFilter.style || '');
        if (cur && !(B.styles || []).some(function (s) { return String(s.id) === cur; })) cur = S.tplFilter.style = '';
        $('#tplStyle').innerHTML = [{id: '', label: '전체', count: B.templates.length}].concat(B.styles || []).map(function (s) {
            var name = s.label.replace(/^\s*\d+\s*[.)]\s*/, '') || s.label;
            return '<button type="button" class="style-btn' + (String(s.id) === cur ? ' is-active' : '') + '" data-style="' + s.id + '" title="' + esc(s.label) + '">' +
                esc(name) + '<span class="n">' + s.count + '</span></button>';
        }).join('');
        $('#tplSearch').value = S.tplFilter.q || '';
        $$('#tplSort button').forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-sort') === (S.tplFilter.sort || 'name')); });
        var html = B.templates.map(function (t) {
            var badge = t.new ? '<span class="pb-new-badge pb-new-badge--day' + t.new + '">NEW</span>' : '';
            var img = t.image ? '<img src="' + esc(t.image) + '" alt="" loading="lazy" decoding="async">' : '<span class="tcard-noimg">' + icon('image') + '</span>';
            return '<button type="button" class="tcard" data-id="' + t.id + '" title="' + esc(t.title + (t.style ? ' [' + t.style + ']' : '')) + '">' +
                '<span class="tcard-thumb">' + badge + img + '</span>' +
                '<span class="tcard-name">' + esc(t.title) + '</span></button>';
        }).join('');
        tplGrid.innerHTML = html;  // 비었을 때 안내는 filterTemplates가 넣는다
        filterTemplates();
    }
    var tplCards = null;
    function filterTemplates() {
        if (!tplCards) tplCards = $$('.tcard', tplGrid);
        var f = S.tplFilter, q = String(f.q || '').trim().toLowerCase(), n = 0;
        var visible = [];
        tplCards.forEach(function (card) {
            var t = TPL[card.getAttribute('data-id')];
            var ok = (!q || t.title.toLowerCase().indexOf(q) !== -1 || (t.style || '').toLowerCase().indexOf(q) !== -1);
            if (ok && f.style) ok = String(t.style_id) === String(f.style);
            card.hidden = !ok;
            if (ok) { n++; visible.push(card); }
        });
        // 정렬
        var sorted = tplCards.slice();
        if (f.sort === 'new') sorted.sort(function (a, b) { return TPL[a.getAttribute('data-id')].cr - TPL[b.getAttribute('data-id')].cr; });
        var frag = document.createDocumentFragment();
        sorted.forEach(function (c) { frag.appendChild(c); });
        tplGrid.appendChild(frag);
        $('#tplMeta').innerHTML = '<span>' + n + '개 템플릿</span>' + (q ? '<span class="faint">“' + esc(q) + '” 검색 결과</span>' : '');
        var empty = $('#tplEmpty');
        if (!n) {
            if (!empty) { empty = document.createElement('div'); empty.id = 'tplEmpty'; empty.className = 'pb-empty'; tplGrid.appendChild(empty); }
            empty.hidden = false;
            empty.textContent = !B.templates.length ? '템플릿이 없습니다. 템플릿 만들기에서 만들거나 데이터 메뉴에서 템플릿 파일을 가져오세요.'
                : (q ? '검색 결과가 없습니다.' : '이 스타일에 템플릿이 없습니다.');
        } else if (empty) { empty.hidden = true; }
        markSelectedCard();
    }
    function markSelectedCard() {
        var id = S.template ? String(S.template.id) : '';
        (tplCards || []).forEach(function (c) { c.classList.toggle('is-selected', c.getAttribute('data-id') === id); });
        $('#tplReset').disabled = !S.template;
    }
    $('#tplStyle').addEventListener('click', function (e) {
        var b = e.target.closest('[data-style]');
        if (!b) return;
        S.tplFilter.style = b.getAttribute('data-style');
        $$('#tplStyle .style-btn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        filterTemplates();
        saveState();
    });
    $('#tplSearch').addEventListener('input', PB.debounce(function () { S.tplFilter.q = $('#tplSearch').value; filterTemplates(); saveState(); }, 120));
    $('#tplSort').addEventListener('click', function (e) {
        var b = e.target.closest('[data-sort]');
        if (!b) return;
        S.tplFilter.sort = b.getAttribute('data-sort');
        $$('#tplSort button').forEach(function (x) { x.classList.toggle('is-active', x === b); });
        filterTemplates();
        saveState();
    });
    $('#tplRandom').addEventListener('click', function () {
        var vis = (tplCards || []).filter(function (c) { return !c.hidden; });
        if (!vis.length) return;
        var c = randomPick(vis);
        selectTemplate(parseInt(c.getAttribute('data-id'), 10));
        c.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    });
    // 템플릿 초기화: 템플릿 없이 인물·의상·배경만으로 조합하거나 프롬프트를 직접 쓴다
    $('#tplReset').addEventListener('click', function () { if (S.template) clearTemplate(); });
    tplGrid.addEventListener('click', function (e) {
        var c = e.target.closest('.tcard');
        if (!c) return;
        var id = parseInt(c.getAttribute('data-id'), 10);
        if (S.template && S.template.id === id) return;
        selectTemplate(id);
    });

    function fetchTemplate(id) {
        if (tplCache[id]) return Promise.resolve(tplCache[id]);
        return PB.api('/api/template/' + id).then(function (d) {
            if (!d || !d.ok) throw new Error((d && d.message) || '템플릿을 불러오지 못했습니다.');
            tplCache[id] = d.template;
            return d.template;
        });
    }
    function selectTemplate(id, keepSlots) {
        S.template = {id: id};
        if (!keepSlots) { S.slots = {}; S.lora.tpl = {}; }
        markSelectedCard();
        renderTemplateDetail(true);
        return fetchTemplate(id).then(function () {
            if (!S.template || S.template.id !== id) return;
            renderTemplateDetail();
            renderCamera();
            update({fromSelection: true});
        }).catch(function (err) {
            PB.toast(err.message, 'error');
            S.template = null;
            markSelectedCard();
            renderTemplateDetail();
            update();
        });
    }
    function clearTemplate() {
        S.template = null;
        S.slots = {};
        S.lora.tpl = {};
        markSelectedCard();
        renderTemplateDetail();
        renderCamera();
        update({fromSelection: true});
    }
    function renderTemplateDetail(loading) {
        var t = currentTemplate();
        var meta = S.template ? TPL[S.template.id] : null;
        if (!S.template || !meta) {
            tplDetail.innerHTML = '<div class="detail-empty">' + icon('layers') +
                '<strong>템플릿을 고르세요</strong><span>왼쪽 목록에서 템플릿을 누르면 세부 항목을 여기서 바꿀 수 있어요. 템플릿 없이 인물·의상·배경만으로 조합하거나 오른쪽 프롬프트에 직접 써도 됩니다.</span></div>';
            return;
        }
        var head = '<div class="detail-head">' +
            (meta.image ? '<img class="detail-thumb" src="' + esc(meta.image) + '" alt="">' : '<div class="detail-thumb is-empty">' + icon('image') + '</div>') +
            '<div class="detail-info"><div class="detail-title">' + esc(meta.title) + '</div>' +
            '<div class="detail-sub">' + (meta.style ? '<span class="chip">' + esc(meta.style) + '</span>' : '') +
            (meta.maker ? '<span class="faint">' + esc(meta.maker) + '</span>' : '') + '</div>' +
            '<div class="detail-actions">' +
            '<button type="button" class="btn btn-sm" data-act="tpl-random"' + (t && t.slots && t.slots.length ? '' : ' disabled') + '>' + icon('dice') + '세부 랜덤</button>' +
            '<a class="btn btn-sm btn-ghost" href="/templates/' + meta.id + '" title="템플릿 편집">' + icon('pen') + '편집</a>' +
            '</div></div></div>';
        if (loading || !t) {
            tplDetail.innerHTML = head + '<div class="detail-loading"><span class="spinner"></span>불러오는 중…</div>';
            return;
        }
        var slots = t.slots || [];
        var rows = slots.map(function (slot) {
            var key = slot.slot_key || slot.label_ko;
            var opts = activeOptions(slot);
            var cur = S.slots[key];
            if (cur === undefined) cur = defaultSlotIndex(slot);
            var label = String(slot.label_ko || key).replace(/_/g, ' ');
            var html = '<option value="">선택 안 함</option>' + opts.map(function (o, i) {
                return '<option value="' + i + '"' + (i === cur ? ' selected' : '') + '>' + esc(String(o.label_ko || '').replace(/_/g, ' ')) + '</option>';
            }).join('');
            return '<label class="sel-row"><span class="sel-label" title="{' + esc(key) + '}">' + esc(label) + '</span>' +
                '<select class="input ' + (cur >= 0 ? 'is-set' : 'is-unset') + '" data-bind="slot" data-key="' + esc(key) + '">' + html + '</select></label>';
        }).join('');
        tplDetail.innerHTML = head + (rows ? '<div class="section-title">세부 항목 <span class="faint">' + slots.length + '개</span></div><div class="sel-list">' + rows + '</div>'
            : '<div class="pb-empty">이 템플릿에는 세부 항목이 없습니다.</div>') +
            (t.negative_prompt ? '<div class="section-title">Negative</div><div class="prompt-box small">' + esc(t.negative_prompt) + '</div>' : '');
    }
    tplDetail.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'tpl-random') {
            var t = currentTemplate();
            if (!t) return;
            (t.slots || []).forEach(function (slot) {
                var key = slot.slot_key || slot.label_ko;
                if (S.slots[key] === -1) return; // 선택 안 함은 유지
                var n = activeOptions(slot).length;
                if (n) S.slots[key] = Math.floor(Math.random() * n);
            });
            renderTemplateDetail();
            update({fromSelection: true});
        }
    });

    /* ================================================================ 2. 인물 */
    var PERSON_CARDS = [['person', '기본', 'user'], ['makeup', '메이크업', 'sparkles'], ['hair', '헤어', 'palette']];
    function renderPerson() {
        $('#personPanel').innerHTML = PERSON_CARDS.map(function (c) {
            var groups = (B.person || {})[c[0]] || [];
            var rows = '';
            if (c[0] === 'person') {
                rows += '<label class="sel-row"><span class="sel-label">나이</span><input class="input' + (S.person.age ? ' is-set' : '') + '" id="ageInput" type="text" inputmode="numeric" placeholder="예: 25" value="' + esc(S.person.age) + '" autocomplete="off"></label>';
            }
            rows += groups.map(function (g) { return selRow(g.label, 'person', c[0] + '|' + g.label, g.items, S.person.sel[c[0] + '|' + g.label] || ''); }).join('');
            var n = countSet(c[0], groups, S.person.sel) + (c[0] === 'person' && S.person.age ? 1 : 0);
            return '<div class="card" data-card="' + c[0] + '">' + cardHead(c[2], c[1], {
                count: n || '',
                actions: '<button type="button" class="icon-btn sm" data-act="person-random" data-sec="' + c[0] + '" title="랜덤">' + icon('dice') + '</button>' +
                    '<button type="button" class="icon-btn sm" data-act="person-reset" data-sec="' + c[0] + '" title="이 카드 초기화">' + icon('refresh') + '</button>'
            }) + '<div class="sel-list">' + (rows || '<div class="faint">등록된 항목이 없습니다. <a class="link" href="/data">데이터</a>에서 프롬프트 요소를 가져오거나 <a class="link" href="/elements">프롬프트 요소</a>에서 추가하세요.</div>') + '</div></div>';
        }).join('');
    }
    function refreshCardCounts() {
        PERSON_CARDS.forEach(function (c) {
            var card = $('#personPanel [data-card="' + c[0] + '"] .card-title');
            if (!card) return;
            var n = countSet(c[0], (B.person || {})[c[0]], S.person.sel) + (c[0] === 'person' && S.person.age ? 1 : 0);
            var chip = $('.chip', card);
            if (n && !chip) { chip = document.createElement('span'); chip.className = 'chip accent'; card.insertBefore(chip, $('.actions', card)); }
            if (chip) { chip.textContent = n; chip.hidden = !n; }
        });
        var cam = $('#cameraPanel [data-card="camera"] .card-title');
        if (cam) {
            var n2 = countSet('', B.camera, S.camera.sel) + (S.camera.art ? 1 : 0);
            var chip2 = $('.chip', cam);
            if (n2 && !chip2) { chip2 = document.createElement('span'); chip2.className = 'chip accent'; cam.insertBefore(chip2, $('.actions', cam)); }
            if (chip2) { chip2.textContent = n2; chip2.hidden = !n2; }
        }
    }
    $('#personPanel').addEventListener('input', function (e) {
        if (e.target.id !== 'ageInput') return;
        S.person.age = e.target.value;
        e.target.classList.toggle('is-set', !!S.person.age.trim());
        refreshCardCounts();
        update({fromSelection: true});
    });
    $('#personPanel').addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (!b) return;
        var sec = b.getAttribute('data-sec');
        var groups = (B.person || {})[sec] || [];
        if (b.getAttribute('data-act') === 'person-reset') {
            groups.forEach(function (g) { delete S.person.sel[sec + '|' + g.label]; });
            if (sec === 'person') S.person.age = '';
        } else {
            groups.forEach(function (g) {
                if (/인원|인종|국적/.test(g.label) && !S.person.sel[sec + '|' + g.label]) return;
                if (g.items.length) S.person.sel[sec + '|' + g.label] = randomPick(g.items).id;
            });
        }
        renderPerson();
        update({fromSelection: true});
    });

    /* ================================================================ 3. 의상 · 포즈 */
    var MODEL_FOLDER = {outfit: {coffeemix: 'outfit', krea: 'outfit_krea'}, places: {coffeemix: 'places', krea: 'places_krea'}};
    var MODEL_LABEL = {coffeemix: 'CoffeeMix V8', krea: 'Krea2'};
    var models = {outfit: (B.settings || {}).outfitModel || 'coffeemix', places: (B.settings || {}).placesModel || 'coffeemix'};
    function presetImage(kind, item) {
        if (!item || !item.file) return '';
        return '/media/' + MODEL_FOLDER[kind][item.model || models[kind]] + '/' + encodeURIComponent(item.file);
    }
    function cascadeHtml(kind, steps, title, ic, items) {
        var st = cascadeState[kind];
        var rows = steps.map(function (step, i) {
            var parentLabel = step.key === 'position' && kind === 'accessory' ? labelOf(st.category)
                : (step.key === 'design' ? labelOf(st.position) : '');
            var list = step.items.filter(function (it) { return !parentLabel || !it.parent || it.parent === parentLabel; });
            var enabled = cascadeEnabled(kind, step.key);
            var opts = '<option value="">' + esc(step.label.replace(/^(악세사리|타투)\s*/, '')) + ' 선택</option>' + list.map(function (it) {
                return '<option value="' + it.id + '"' + (String(st[step.key] || '') === String(it.id) ? ' selected' : '') + '>' + esc(it.label) + '</option>';
            }).join('');
            return '<select class="input ' + (st[step.key] ? 'is-set' : 'is-unset') + '" data-bind="cascade" data-kind="' + kind + '" data-step="' + step.key + '"' + (enabled ? '' : ' disabled') + '>' + opts + '</select>';
        }).join('');
        var ready = cascadeReady(kind);
        var list = items.length ? items.map(function (it, i) {
            return '<div class="item-row"><span>' + esc(it.label) + '</span><button type="button" class="icon-btn sm" data-act="cascade-remove" data-kind="' + kind + '" data-i="' + i + '" title="삭제">' + icon('x') + '</button></div>';
        }).join('') : '<div class="faint item-empty">추가한 ' + title + '가 없습니다.</div>';
        return '<div class="card">' + cardHead(ic, title, {
            count: items.length || '',
            actions: items.length ? '<button type="button" class="icon-btn sm" data-act="cascade-clear" data-kind="' + kind + '" title="모두 삭제">' + icon('refresh') + '</button>' : ''
        }) + '<div class="cascade">' + rows + '<button type="button" class="btn btn-sm' + (ready ? ' btn-primary' : '') + '" data-act="cascade-add" data-kind="' + kind + '"' + (ready ? '' : ' disabled') + '>' + icon('plus') + '추가</button></div>' +
            '<div class="item-list">' + list + '</div></div>';
    }
    var cascadeState = {accessory: {}, tattoo: {}};
    function labelOf(id) { return id && EL[id] ? EL[id].label : ''; }
    var CASCADE_ORDER = {accessory: ['category', 'position', 'direction', 'design'], tattoo: ['position', 'direction', 'style', 'detail']};
    function cascadeEnabled(kind, key) {
        var order = CASCADE_ORDER[kind], st = cascadeState[kind];
        var i = order.indexOf(key);
        if (i <= 0) return true;
        if (kind === 'accessory' && key === 'design') return !!st.position;
        return !!st[order[i - 1]];
    }
    function cascadeReady(kind) {
        var st = cascadeState[kind];
        return kind === 'accessory' ? !!st.design : !!st.detail;
    }
    function onCascade(sel) {
        var kind = sel.getAttribute('data-kind'), step = sel.getAttribute('data-step');
        var st = cascadeState[kind], order = CASCADE_ORDER[kind];
        st[step] = sel.value ? parseInt(sel.value, 10) : 0;
        // 뒤 단계 초기화
        order.slice(order.indexOf(step) + 1).forEach(function (k) { if (!(kind === 'accessory' && step === 'direction' && k === 'design')) delete st[k]; });
        renderOutfit();
    }
    function addCascadeItem(kind) {
        var st = cascadeState[kind], order = CASCADE_ORDER[kind];
        var labels = order.map(function (k) { return labelOf(st[k]); }).filter(Boolean).join(' / ');
        var p = function (k) { return st[k] && EL[st[k]] ? EL[st[k]].prompt : ''; };
        var prompt = kind === 'accessory' ? clean([p('direction'), p('design')].filter(Boolean).join(' '))
            : clean([p('direction'), p('position'), p('style'), p('detail')].filter(Boolean).join(', '));
        if (!prompt) return;
        (kind === 'accessory' ? S.accessories : S.tattoos).push({label: labels || prompt, prompt: prompt});
        cascadeState[kind] = {};
        renderOutfit();
        update({fromSelection: true});
    }

    function renderOutfit() {
        var o = S.outfit;
        var seg = '<div class="seg seg-sm"><button type="button" data-act="outfit-mode" data-mode="preset" class="' + (o.mode === 'preset' ? 'is-active' : '') + '">프리셋</button>' +
            '<button type="button" data-act="outfit-mode" data-mode="manual" class="' + (o.mode === 'manual' ? 'is-active' : '') + '">직접 구성</button></div>';
        var body;
        if (o.mode === 'preset') {
            if (o.preset) {
                var img = presetImage('outfit', o.preset);
                body = '<div class="preset-pick">' +
                    '<button type="button" class="preset-image portrait" data-act="outfit-open" title="다른 의상 고르기">' + (img ? '<img src="' + esc(img) + '" alt="" onerror="this.parentNode.classList.add(\'noimg\')">' : '') + '<span class="noimg-label">이미지 없음</span></button>' +
                    '<div class="preset-info"><div class="preset-title">' + esc(o.preset.name) + '</div>' +
                    '<div class="detail-sub"><span class="chip">' + esc(o.preset.type) + '</span><span class="faint">' + esc(MODEL_LABEL[o.preset.model] || '') + '</span></div>' +
                    '<div class="prompt-box small">' + esc(o.preset.prompt) + '</div>' +
                    '<div class="detail-actions"><button type="button" class="btn btn-sm" data-act="outfit-open">' + icon('grid') + '바꾸기</button>' +
                    '<button type="button" class="btn btn-sm" data-act="outfit-random">' + icon('dice') + '랜덤</button>' +
                    '<button type="button" class="btn btn-sm btn-ghost" data-act="outfit-clear">' + icon('x') + '제거</button></div></div></div>';
            } else {
                body = '<div class="preset-empty"><button type="button" class="pick-big" data-act="outfit-open">' + icon('shirt') + '<strong>의상 프리셋 고르기</strong><span>이미지를 보고 의상을 고릅니다</span></button>' +
                    '<button type="button" class="btn" data-act="outfit-random">' + icon('dice') + '랜덤 의상</button></div>';
            }
        } else {
            var kindSel = '<label class="sel-row"><span class="sel-label">구성 방식</span><select class="input ' + (o.kind ? 'is-set' : 'is-unset') + '" data-bind="outfitKind" data-key="">' +
                '<option value="">선택 안 함</option>' + (B.outfitModes || []).map(function (m) {
                    return '<option value="' + m.value + '"' + (o.kind === m.value ? ' selected' : '') + '>' + esc(m.label) + '</option>';
                }).join('') + '</select></label>';
            var rows = o.kind ? B.outfit.filter(function (g) { return g.modes.indexOf(o.kind) !== -1; }).map(function (g) {
                return selRow(g.label, 'outfitSel', g.label, g.items, o.sel[g.label] || '');
            }).join('') : '<div class="faint">구성 방식을 고르면 세부 항목이 나타납니다.</div>';
            body = '<div class="sel-list">' + kindSel + rows + '</div>';
        }
        var outfitCount = o.mode === 'preset' ? (o.preset ? 1 : 0) : (o.kind ? Object.keys(o.sel).filter(function (k) { return B.outfit.some(function (g) { return g.label === k && g.modes.indexOf(o.kind) !== -1; }); }).length : 0);
        var outfitCard = '<div class="card card-outfit">' + cardHead('shirt', '의상', {
            count: outfitCount || '',
            actions: seg + '<button type="button" class="icon-btn sm" data-act="outfit-reset" title="의상 초기화">' + icon('refresh') + '</button>'
        }) + body + '</div>';
        var poseRows = (B.pose || []).map(function (g) { return selRow(g.label, 'pose', g.label, g.items, S.pose[g.label] || ''); }).join('');
        var poseCount = countSet('', B.pose, S.pose);
        var poseCard = '<div class="card">' + cardHead('pose', '포즈', {
            count: poseCount || '',
            actions: '<button type="button" class="icon-btn sm" data-act="pose-random" title="랜덤">' + icon('dice') + '</button><button type="button" class="icon-btn sm" data-act="pose-reset" title="초기화">' + icon('refresh') + '</button>'
        }) + '<div class="sel-list">' + (poseRows || '<div class="faint">등록된 포즈가 없습니다.</div>') + '</div></div>';
        var acc = (B.accessory || []).length ? cascadeHtml('accessory', B.accessory, '악세사리', 'gem', S.accessories) : '';
        var tat = (B.tattoo || []).length ? cascadeHtml('tattoo', B.tattoo, '타투', 'pen', S.tattoos) : '';
        $('#outfitPanel').innerHTML = outfitCard + '<div class="stack">' + poseCard + acc + tat + '</div>';
    }
    $('#outfitPanel').addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'outfit-mode') { S.outfit.mode = b.getAttribute('data-mode'); renderOutfit(); update({fromSelection: true}); }
        else if (act === 'outfit-open') openPicker('outfit');
        else if (act === 'outfit-random') randomOutfit();
        else if (act === 'outfit-clear') { S.outfit.preset = null; renderOutfit(); update({fromSelection: true}); }
        else if (act === 'outfit-reset') { S.outfit.preset = null; S.outfit.kind = ''; S.outfit.sel = {}; renderOutfit(); update({fromSelection: true}); }
        else if (act === 'pose-reset') { S.pose = {}; renderOutfit(); update({fromSelection: true}); }
        else if (act === 'pose-random') { (B.pose || []).forEach(function (g) { if (g.items.length) S.pose[g.label] = randomPick(g.items).id; }); renderOutfit(); update({fromSelection: true}); }
        else if (act === 'cascade-add') addCascadeItem(b.getAttribute('data-kind'));
        else if (act === 'cascade-remove') {
            var list = b.getAttribute('data-kind') === 'accessory' ? S.accessories : S.tattoos;
            list.splice(parseInt(b.getAttribute('data-i'), 10), 1);
            renderOutfit(); update({fromSelection: true});
        } else if (act === 'cascade-clear') {
            if (b.getAttribute('data-kind') === 'accessory') S.accessories = []; else S.tattoos = [];
            renderOutfit(); update({fromSelection: true});
        }
    });

    /* ================================================================ 4. 배경 */
    function renderBackground() {
        var p = S.place, body;
        if (p) {
            var img = presetImage('places', p);
            body = '<div class="preset-pick landscape">' +
                '<button type="button" class="preset-image landscape" data-act="place-open" title="다른 배경 고르기">' + (img ? '<img src="' + esc(img) + '" alt="" onerror="this.parentNode.classList.add(\'noimg\')">' : '') + '<span class="noimg-label">이미지 없음</span></button>' +
                '<div class="preset-info"><div class="preset-title">' + esc(p.label) + '</div>' +
                '<div class="detail-sub"><span class="chip">' + esc(p.country) + '</span>' + (p.type ? '<span class="chip">' + esc(p.type) + '</span>' : '') + '<span class="faint">' + esc(MODEL_LABEL[p.model] || '') + '</span></div>' +
                (p.description ? '<p class="muted small">' + esc(p.description) + '</p>' : '') +
                '<div class="detail-actions"><button type="button" class="btn btn-sm" data-act="place-open">' + icon('grid') + '바꾸기</button>' +
                '<button type="button" class="btn btn-sm" data-act="place-random">' + icon('dice') + '랜덤</button>' +
                '<button type="button" class="btn btn-sm btn-ghost" data-act="place-clear">' + icon('x') + '제거</button></div></div></div>';
        } else {
            body = '<div class="preset-empty"><button type="button" class="pick-big wide" data-act="place-open">' + icon('globe') + '<strong>유명 배경 고르기</strong><span>나라별 명소 ' + '이미지에서 배경을 고릅니다</span></button>' +
                '<button type="button" class="btn" data-act="place-random">' + icon('dice') + '랜덤 배경</button></div>';
        }
        var placeCard = '<div class="card card-place">' + cardHead('mountain', '유명 배경', {count: p ? 1 : ''}) + body + '</div>';
        var slotRows = (B.placeSlots || []).map(function (slot) {
            var idx = S.placeSlots[slot.key];
            if (idx === undefined) idx = placeSlotDefault(slot);
            var opts = '<option value="">선택 안 함</option>' + slot.options.map(function (o, i) {
                return '<option value="' + i + '"' + (i === idx ? ' selected' : '') + '>' + esc(o.label) + '</option>';
            }).join('');
            return '<label class="sel-row"><span class="sel-label">' + esc(slot.label) + '</span><select class="input ' + (idx >= 0 ? 'is-set' : 'is-unset') + '" data-bind="placeSlot" data-key="' + esc(slot.key) + '">' + opts + '</select></label>';
        }).join('');
        var slotCard = '<div class="card' + (p ? '' : ' is-disabled') + '">' + cardHead('sliders', '배경 분위기', {
            actions: '<button type="button" class="icon-btn sm" data-act="slot-random" title="랜덤"' + (p ? '' : ' disabled') + '>' + icon('dice') + '</button><button type="button" class="icon-btn sm" data-act="slot-reset" title="기본값으로"' + (p ? '' : ' disabled') + '>' + icon('refresh') + '</button>'
        }) + (p ? '<div class="sel-list">' + slotRows + '</div><p class="help">시간대·날씨·조명 같은 배경 분위기를 바꿉니다.</p>' : '<div class="faint">배경을 고르면 시간대·날씨·조명·색감을 조절할 수 있어요.</div>') + '</div>';
        $('#backgroundPanel').innerHTML = placeCard + slotCard;
    }
    $('#backgroundPanel').addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'place-open') openPicker('places');
        else if (act === 'place-random') randomPlace();
        else if (act === 'place-clear') { S.place = null; renderBackground(); update({fromSelection: true}); }
        else if (act === 'slot-reset') { S.placeSlots = {}; renderBackground(); update({fromSelection: true}); }
        else if (act === 'slot-random') {
            (B.placeSlots || []).forEach(function (s) { S.placeSlots[s.key] = Math.floor(Math.random() * s.options.length); });
            renderBackground(); update({fromSelection: true});
        }
    });

    /* ================================================================ 5. 카메라 · 품질 · LoRA */
    function renderCamera() {
        var camRows = '<label class="sel-row"><span class="sel-label">그림체</span><select class="input ' + (S.camera.art ? 'is-set' : 'is-unset') + '" data-bind="art" data-key="">' +
            '<option value="">선택 안 함</option>' + (B.artStyles || []).map(function (a) {
                return '<option value="' + esc(a.prompt) + '"' + (S.camera.art === a.prompt ? ' selected' : '') + '>' + esc(a.label) + '</option>';
            }).join('') + '</select></label>' +
            (B.camera || []).map(function (g) { return selRow(g.label, 'camera', g.label, g.items, S.camera.sel[g.label] || ''); }).join('');
        var camCount = countSet('', B.camera, S.camera.sel) + (S.camera.art ? 1 : 0);
        var camCard = '<div class="card" data-card="camera">' + cardHead('camera', '카메라', {
            count: camCount || '',
            actions: '<button type="button" class="icon-btn sm" data-act="cam-reset" title="초기화">' + icon('refresh') + '</button>'
        }) + '<div class="sel-list">' + camRows + '</div></div>';

        var renderRows = (B.render || []).map(function (g) {
            var id = S.render.sel[g.label];
            if (id === undefined) id = renderDefaultId(g);
            return selRow(g.label, 'render', g.label, g.items, id || '');
        }).join('');
        var renderCard = '<div class="card' + (S.render.on ? '' : ' is-off') + '">' + cardHead('sparkles', '품질 · 렌더링', {
            actions: '<label class="switch" title="품질 프롬프트 사용"><input type="checkbox" id="renderOn"' + (S.render.on ? ' checked' : '') + '></label>' +
                '<button type="button" class="icon-btn sm" data-act="render-reset" title="기본값으로">' + icon('refresh') + '</button>'
        }) + '<div class="sel-list">' + renderRows +
            '<label class="sel-row"><span class="sel-label">직접 입력</span><input class="input" id="renderExtra" type="text" placeholder="예: film grain" value="' + esc(S.render.extra) + '" spellcheck="false"></label></div></div>';

        $('#cameraPanel').innerHTML = camCard + renderCard + loraCardHtml();
    }
    function loraCardHtml() {
        var t = currentTemplate();
        var tplEntries = t ? templateLoraEntries(t) : [];
        var selected = Object.keys(S.lora.sel).filter(function (id) { return LORA[id]; });
        var selRows = selected.map(function (id) {
            var l = LORA[id];
            return '<div class="item-row"><span>' + esc(l.title) + '</span>' +
                '<input class="input strength" type="number" min="0" max="2" step="0.05" value="' + fmtStrength(S.lora.sel[id]) + '" data-lora-strength="' + id + '" title="강도">' +
                '<button type="button" class="icon-btn sm" data-act="lora-remove" data-id="' + id + '" title="빼기">' + icon('x') + '</button></div>';
        }).join('') + tplEntries.map(function (en) {
            var o = S.lora.tpl[en.name] || {};
            return '<div class="item-row' + (o.off ? ' is-off' : '') + '"><span>' + esc(en.file) + ' <span class="chip">템플릿</span></span>' +
                '<input class="input strength" type="number" min="0" max="2" step="0.05" value="' + fmtStrength(o.strength != null ? o.strength : en.strength) + '" data-tpl-lora="' + esc(en.name) + '" title="강도"' + (o.off ? ' disabled' : '') + '>' +
                '<button type="button" class="icon-btn sm" data-act="tpl-lora-toggle" data-name="' + esc(en.name) + '" title="' + (o.off ? '다시 쓰기' : '빼기') + '">' + icon(o.off ? 'plus' : 'x') + '</button></div>';
        }).join('');
        var list = (B.loras || []).map(function (l) {
            var on = S.lora.sel[l.id] != null;
            return '<button type="button" class="lora-row' + (on ? ' is-on' : '') + '" data-act="lora-toggle" data-id="' + l.id + '" data-search="' + esc((l.title + ' ' + l.support + ' ' + l.filename).toLowerCase()) + '">' +
                '<span class="lora-check">' + icon('check') + '</span><span class="lora-title">' + esc(l.title) + '</span>' +
                (l.support ? '<span class="chip">' + esc(l.support) + '</span>' : '') + '</button>';
        }).join('');
        var count = selected.length + tplEntries.filter(function (e) { return !(S.lora.tpl[e.name] || {}).off; }).length;
        return '<div class="card card-lora">' + cardHead('link', 'LoRA', {
            count: count || '',
            actions: '<a class="btn btn-sm btn-ghost" href="/lora" title="LoRA 목록 관리">' + icon('gear') + '</a>'
        }) + (selRows ? '<div class="item-list">' + selRows + '</div>' : '') +
            ((B.loras || []).length ? '<div class="search-wrap" style="margin-top:10px">' + icon('search') + '<input class="input" id="loraSearch" type="search" placeholder="LoRA 검색" autocomplete="off"></div><div class="lora-list" id="loraList">' + list + '</div>'
                : '<div class="pb-empty" style="margin-top:8px">등록된 LoRA가 없습니다.<br><a href="/lora" class="link">LoRA 메뉴에서 추가</a></div>') +
            '<p class="help">프롬프트 맨 앞에 &lt;lora:이름:강도&gt; 태그로 들어갑니다. workflow 안의 LoRA 노드는 오른쪽 생성 패널에서 조절하세요.</p></div>';
    }
    $('#cameraPanel').addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]');
        if (!b) return;
        var act = b.getAttribute('data-act');
        if (act === 'cam-reset') { S.camera = {art: '', sel: {}}; }
        else if (act === 'render-reset') { S.render = {on: true, sel: {}, extra: ''}; }
        else if (act === 'lora-toggle') {
            var id = b.getAttribute('data-id');
            if (S.lora.sel[id] != null) delete S.lora.sel[id]; else S.lora.sel[id] = LORA[id] ? LORA[id].strength : 1;
            var q = ($('#loraSearch') || {}).value || '';
            renderCamera();
            if (q) { $('#loraSearch').value = q; filterLora(); }
            update({fromSelection: true});
            return;
        } else if (act === 'lora-remove') { delete S.lora.sel[b.getAttribute('data-id')]; }
        else if (act === 'tpl-lora-toggle') {
            var n = b.getAttribute('data-name');
            var o = S.lora.tpl[n] || {};
            o.off = !o.off;
            S.lora.tpl[n] = o;
        } else return;
        renderCamera();
        update({fromSelection: true});
    });
    $('#cameraPanel').addEventListener('change', function (e) {
        var t = e.target;
        if (t.id === 'renderOn') { S.render.on = t.checked; t.closest('.card').classList.toggle('is-off', !t.checked); update({fromSelection: true}); }
        if (t.hasAttribute('data-lora-strength')) { t.value = fmtStrength(t.value); S.lora.sel[t.getAttribute('data-lora-strength')] = parseFloat(t.value); update({fromSelection: true}); }
        if (t.hasAttribute('data-tpl-lora')) {
            t.value = fmtStrength(t.value);
            var n = t.getAttribute('data-tpl-lora');
            S.lora.tpl[n] = Object.assign(S.lora.tpl[n] || {}, {strength: parseFloat(t.value)});
            update({fromSelection: true});
        }
    });
    $('#cameraPanel').addEventListener('input', function (e) {
        if (e.target.id === 'renderExtra') { S.render.extra = e.target.value; update({fromSelection: true}); }
        if (e.target.id === 'loraSearch') filterLora();
    });
    function filterLora() {
        var q = String(($('#loraSearch') || {}).value || '').trim().toLowerCase();
        $$('#loraList .lora-row').forEach(function (r) { r.hidden = !!q && r.getAttribute('data-search').indexOf(q) === -1; });
    }

    /* ================================================================ 프리셋 피커 (의상 · 배경) */
    var presetData = {outfit: null, places: null};
    function loadPresetData(kind) {
        if (presetData[kind]) return Promise.resolve(presetData[kind]);
        return PB.api(kind === 'outfit' ? '/api/outfit/items' : '/api/places').then(function (d) {
            if (!d || !d.ok) throw new Error((d && d.message) || '목록을 불러오지 못했습니다.');
            presetData[kind] = d.items || [];
            return presetData[kind];
        });
    }
    function chooseOutfit(item, model) {
        S.outfit.mode = 'preset';
        S.outfit.preset = {type: item.type, name: item.name, prompt: item.prompt, file: item.file, model: model || models.outfit, id: item.id};
        renderOutfit();
        update({fromSelection: true});
    }
    function choosePlace(item, model) {
        S.place = {idx: item.idx, country: item.country, type: item.type, label: item.label, prompt: item.prompt, description: item.description, file: item.file, model: model || models.places};
        renderBackground();
        update({fromSelection: true});
    }
    function randomOutfit() {
        loadPresetData('outfit').then(function (items) { if (items.length) chooseOutfit(randomPick(items)); }).catch(function (e) { PB.toast(e.message, 'error'); });
    }
    function randomPlace() {
        loadPresetData('places').then(function (items) { if (items.length) choosePlace(randomPick(items)); }).catch(function (e) { PB.toast(e.message, 'error'); });
    }

    function openPicker(kind) {
        var isOutfit = kind === 'outfit';
        var current = isOutfit ? S.outfit.preset : S.place;
        var ov = document.createElement('div');
        ov.className = 'picker';
        ov.innerHTML = '<header class="picker-head">' +
            '<h2>' + icon(isOutfit ? 'shirt' : 'globe') + (isOutfit ? '의상 프리셋' : '유명 배경') + '</h2>' +
            '<div class="search-wrap">' + icon('search') + '<input class="input" data-pk="search" type="search" placeholder="' + (isOutfit ? '이름 검색' : '장소 · 나라 검색') + '" autocomplete="off" spellcheck="false"></div>' +
            '<div class="seg" data-pk="model" title="미리보기 이미지를 만든 모델">' + Object.keys(MODEL_LABEL).map(function (m) {
                return '<button type="button" data-m="' + m + '"' + (m === models[kind] ? ' class="is-active"' : '') + '>' + MODEL_LABEL[m] + '</button>';
            }).join('') + '</div>' +
            '<div class="seg" data-pk="size"><button type="button" data-s="s">작게</button><button type="button" data-s="m" class="is-active">보통</button><button type="button" data-s="l">크게</button></div>' +
            '<div class="spacer"></div><span class="faint" data-pk="count"></span>' +
            '<button type="button" class="icon-btn" data-pk="close" title="닫기 (Esc)">' + icon('x') + '</button></header>' +
            '<div class="picker-body"><aside class="picker-groups" data-pk="groups"><div class="picker-loading"><span class="spinner"></span></div></aside>' +
            '<div class="picker-grid ' + kind + ' size-m" data-pk="grid"></div></div>';
        document.body.appendChild(ov);
        document.body.classList.add('has-overlay');
        var q = function (k) { return ov.querySelector('[data-pk="' + k + '"]'); };
        var items = [], group = '', search = '', zoomIndex = -1, visible = [];
        var lastGroupKey = 'pb.picker.' + kind;
        function groupOf(it) { return isOutfit ? it.type : it.country; }
        function close() {
            document.removeEventListener('keydown', onKey, true);
            document.body.classList.remove('has-overlay');
            ov.remove();
        }
        function imgSrc(it) { return '/media/' + MODEL_FOLDER[kind][models[kind]] + '/' + encodeURIComponent(it.file); }
        function renderGroups() {
            var counts = {};
            items.forEach(function (it) { var g = groupOf(it); counts[g] = (counts[g] || 0) + 1; });
            var names = Object.keys(counts).sort(function (a, b) {
                if (a === '기타') return 1; if (b === '기타') return -1;
                return a.localeCompare(b, 'ko');
            });
            var html = (isOutfit ? '' : '<div class="search-wrap picker-group-search">' + icon('search') + '<input class="input" data-pk="gsearch" type="search" placeholder="나라 찾기"></div>') +
                '<button type="button" class="pg-item' + (group === '' ? ' is-active' : '') + '" data-g="">전체<span>' + items.length + '</span></button>' +
                names.map(function (n) {
                    return '<button type="button" class="pg-item' + (group === n ? ' is-active' : '') + '" data-g="' + esc(n) + '">' + esc(n) + '<span>' + counts[n] + '</span></button>';
                }).join('');
            q('groups').innerHTML = html;
        }
        function renderGrid() {
            var s = search.trim().toLowerCase();
            visible = items.filter(function (it) {
                if (group && groupOf(it) !== group) return false;
                if (!s) return true;
                return (it.label + ' ' + (it.name || '') + ' ' + (it.country || '') + ' ' + (it.type || '')).toLowerCase().indexOf(s) !== -1;
            });
            var curKey = current ? (isOutfit ? current.file + '|' + current.name : String(current.idx)) : '';
            q('grid').innerHTML = visible.map(function (it, i) {
                var key = isOutfit ? it.file + '|' + it.name : String(it.idx);
                var sel = key === curKey;
                var sub = isOutfit ? (group ? '' : it.type) : (group ? it.type : it.country);
                return '<button type="button" class="pcard' + (sel ? ' is-selected' : '') + '" data-i="' + i + '" title="' + esc(it.label) + '">' +
                    '<span class="pcard-img"><img src="' + esc(imgSrc(it)) + '" alt="" loading="lazy" decoding="async" onerror="this.parentNode.classList.add(\'noimg\')"><span class="noimg-label">이미지 없음</span></span>' +
                    '<span class="pcard-cap"><b>' + esc(it.label) + '</b>' + (sub ? '<i>' + esc(sub) + '</i>' : '') + '</span>' +
                    '<span class="pcard-zoom" data-zoom="' + i + '" title="크게 보기">' + icon('zoom') + '</span>' +
                    (sel ? '<span class="pcard-check">' + icon('check') + '</span>' : '') + '</button>';
            }).join('') || '<div class="pb-empty">' + (items.length ? '결과가 없습니다.'
                : (isOutfit ? '의상 프리셋이 없습니다. 데이터 메뉴에서 의상 프리셋 파일을 가져오세요.' : '유명 배경이 없습니다. 데이터 메뉴에서 유명 배경 파일을 가져오세요.')) + '</div>';
            q('count').textContent = visible.length + '개';
            var selEl = q('grid').querySelector('.is-selected');
            if (selEl && !s) selEl.scrollIntoView({block: 'center'});
        }
        function pick(it) {
            if (isOutfit) chooseOutfit(it, models.outfit); else choosePlace(it, models.places);
            close();
        }
        function openZoom(i) {
            zoomIndex = i;
            var it = visible[i];
            if (!it) return;
            var z = ov.querySelector('.picker-zoom');
            if (!z) {
                z = document.createElement('div');
                z.className = 'picker-zoom';
                ov.appendChild(z);
            }
            z.innerHTML = '<button type="button" class="lightbox-nav prev" data-z="prev"' + (i <= 0 ? ' disabled' : '') + '>' + icon('chevron-left') + '</button>' +
                '<figure><img src="' + esc(imgSrc(it)) + '" alt=""><figcaption><b>' + esc(it.label) + '</b><span>' + esc(isOutfit ? it.type : it.country + (it.type ? ' · ' + it.type : '')) + '</span>' +
                (it.description ? '<span class="faint">' + esc(it.description) + '</span>' : '') +
                '<span class="faint">' + (i + 1) + ' / ' + visible.length + ' · ← → 이동 · Enter 선택 · Esc 닫기</span>' +
                '<span class="zoom-actions"><button type="button" class="btn btn-primary" data-z="pick">' + icon('check') + '이걸로 선택</button><button type="button" class="btn" data-z="close">닫기</button></span></figcaption></figure>' +
                '<button type="button" class="lightbox-nav next" data-z="next"' + (i >= visible.length - 1 ? ' disabled' : '') + '>' + icon('chevron-right') + '</button>';
        }
        function closeZoom() { var z = ov.querySelector('.picker-zoom'); if (z) z.remove(); zoomIndex = -1; }
        function onKey(e) {
            var zooming = zoomIndex >= 0;
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (zooming) closeZoom(); else close(); }
            else if (zooming && e.key === 'ArrowLeft' && zoomIndex > 0) { e.preventDefault(); openZoom(zoomIndex - 1); }
            else if (zooming && e.key === 'ArrowRight' && zoomIndex < visible.length - 1) { e.preventDefault(); openZoom(zoomIndex + 1); }
            else if (zooming && e.key === 'Enter') { e.preventDefault(); pick(visible[zoomIndex]); }
        }
        document.addEventListener('keydown', onKey, true);
        ov.addEventListener('click', function (e) {
            var t = e.target;
            if (t.closest('[data-pk="close"]')) return close();
            var z = t.closest('[data-z]');
            if (z) {
                var a = z.getAttribute('data-z');
                if (a === 'prev') openZoom(zoomIndex - 1);
                else if (a === 'next') openZoom(zoomIndex + 1);
                else if (a === 'pick') pick(visible[zoomIndex]);
                else closeZoom();
                return;
            }
            if (t.classList.contains('picker-zoom')) return closeZoom();
            var zb = t.closest('[data-zoom]');
            if (zb) { e.stopPropagation(); openZoom(parseInt(zb.getAttribute('data-zoom'), 10)); return; }
            var card = t.closest('.pcard');
            if (card) return pick(visible[parseInt(card.getAttribute('data-i'), 10)]);
            var g = t.closest('.pg-item');
            if (g) {
                group = g.getAttribute('data-g');
                try { localStorage.setItem(lastGroupKey, group); } catch (err) {}
                $$('.pg-item', ov).forEach(function (x) { x.classList.toggle('is-active', x === g); });
                renderGrid();
                q('grid').scrollTop = 0;
                return;
            }
            var m = t.closest('[data-m]');
            if (m) {
                models[kind] = m.getAttribute('data-m');
                $$('[data-m]', ov).forEach(function (x) { x.classList.toggle('is-active', x === m); });
                PB.api('/api/settings', kind === 'outfit' ? {outfit_model: models[kind]} : {places_model: models[kind]});
                renderGrid();
                return;
            }
            var sz = t.closest('[data-s]');
            if (sz) {
                $$('[data-s]', ov).forEach(function (x) { x.classList.toggle('is-active', x === sz); });
                q('grid').className = 'picker-grid ' + kind + ' size-' + sz.getAttribute('data-s');
            }
        });
        ov.addEventListener('input', function (e) {
            if (e.target.getAttribute('data-pk') === 'search') { search = e.target.value; renderGrid(); }
            if (e.target.getAttribute('data-pk') === 'gsearch') {
                var gq = e.target.value.trim().toLowerCase();
                $$('.pg-item', ov).forEach(function (x) { var g = x.getAttribute('data-g'); x.hidden = !!gq && !!g && g.toLowerCase().indexOf(gq) === -1; });
            }
        });
        setTimeout(function () { var s = q('search'); if (s) s.focus(); }, 30);
        loadPresetData(kind).then(function (list) {
            items = list;
            if (current) group = isOutfit ? current.type : current.country;
            else { try { group = localStorage.getItem(lastGroupKey) || ''; } catch (err) { group = ''; } }
            if (group && !items.some(function (it) { return groupOf(it) === group; })) group = '';
            renderGroups();
            renderGrid();
            var active = ov.querySelector('.pg-item.is-active');
            if (active) active.scrollIntoView({block: 'nearest'});
        }).catch(function (err) {
            q('groups').innerHTML = '';
            q('grid').innerHTML = '<div class="pb-empty">' + esc(err.message) + '</div>';
        });
    }

    /* ================================================================ 도크: 프롬프트 */
    posOut.addEventListener('input', function () {
        S.manual.pos = posOut.value;
        update();
    });
    negOut.addEventListener('input', function () {
        S.manual.neg = negOut.value;
        update();
    });
    $('#promptRevert').addEventListener('click', function () {
        S.manual = {pos: null, neg: null};
        update();
        PB.toast('선택값으로 다시 조합했습니다.');
    });
    $('#copyPos').addEventListener('click', function () { copyOut(posOut.value, 'Positive'); });
    $('#copyNeg').addEventListener('click', function () { copyOut(negOut.value, 'Negative'); });
    function copyOut(text, label) {
        if (!text) return;
        PB.copy(text).then(function (ok) { PB.toast(ok ? label + ' 프롬프트를 복사했습니다.' : '복사하지 못했습니다.', ok ? '' : 'error'); });
    }
    $('#extraPos').value = S.extra.pos || '';
    $('#extraNeg').value = S.extra.neg || '';
    if (S.extra.pos || S.extra.neg) $('#extraBox').open = true;
    $('#extraPos').addEventListener('input', function () { S.extra.pos = this.value; update({fromSelection: true}); });
    $('#extraNeg').addEventListener('input', function () { S.extra.neg = this.value; update({fromSelection: true}); });

    $('#resetAllBtn').addEventListener('click', function () {
        PB.confirm('모든 선택을 초기화할까요?', '템플릿·인물·의상·배경·카메라·LoRA 선택과 직접 수정한 프롬프트가 지워집니다. 생성 설정은 그대로 둡니다.', {confirmText: '초기화'}).then(function (ok) {
            if (!ok) return;
            var keep = {gen: S.gen, tplFilter: S.tplFilter};
            S = blankState();
            S.gen = keep.gen;
            S.tplFilter = keep.tplFilter;
            cascadeState = {accessory: {}, tattoo: {}};
            $('#extraPos').value = '';
            $('#extraNeg').value = '';
            renderAll();
            setTab('template');
            update();
        });
    });

    /* ================================================================ 도크: 생성 */
    function wfDefaults(wf) {
        var d = {width: null, height: null, cfg: null, steps: null};
        Object.keys(wf || {}).forEach(function (k) {
            var n = wf[k];
            if (!n || !n.inputs) return;
            var ct = String(n.class_type || '').toLowerCase();
            var latent = /empty.*latent.*image/.test(ct) || ct.indexOf('emptylatent') !== -1 || ct.indexOf('latent image') !== -1;
            if (latent) {
                if (d.width === null && typeof n.inputs.width === 'number') d.width = n.inputs.width;
                if (d.height === null && typeof n.inputs.height === 'number') d.height = n.inputs.height;
            }
            if (ct.indexOf('sampler') !== -1) {
                if (d.cfg === null && typeof n.inputs.cfg === 'number') d.cfg = n.inputs.cfg;
                if (d.steps === null && typeof n.inputs.steps === 'number') d.steps = n.inputs.steps;
            }
        });
        return d;
    }
    function firstNum(vals) {
        for (var i = 0; i < vals.length; i++) { var n = parseFloat(vals[i]); if (Number.isFinite(n)) return n; }
        return 1;
    }
    function wfLoraItems(wf) {
        var items = [];
        Object.keys(wf || {}).forEach(function (nid) {
            var n = wf[nid];
            if (!n || !n.inputs) return;
            var title = String((n._meta && n._meta.title) || n.class_type || nid);
            var nodeText = (String(n.class_type || '') + ' ' + title).toLowerCase();
            Object.keys(n.inputs).forEach(function (key) {
                var v = n.inputs[key], kt = key.toLowerCase();
                if (v && typeof v === 'object' && !Array.isArray(v)) {
                    var name = String(v.lora || v.lora_name || v.name || '').trim();
                    if (name && (nodeText.indexOf('lora') !== -1 || kt.indexOf('lora') !== -1)) {
                        items.push({node: nid, key: key, name: name, strength: firstNum([v.strength, v.strength_model, v.strengthTwo, v.strength_clip]), enabled: v.on !== false && v.enabled !== false, toggle: true});
                    }
                } else if ((kt === 'lora_name' || kt === 'lora') && typeof v === 'string' && v.trim()) {
                    items.push({node: nid, key: key, name: v, strength: firstNum([n.inputs.strength_model, n.inputs.strength_clip, n.inputs.strength]), enabled: true, toggle: false});
                }
            });
        });
        return items;
    }
    function genWf() { return WF[S.gen.workflow] || null; }
    function ensureGenDefaults() {
        var servers = B.servers || [];
        if (servers.indexOf(S.gen.server) === -1) S.gen.server = servers[0] || '';
        if (!WF[S.gen.workflow]) {
            var def = (B.settings || {}).defaultWorkflow;
            S.gen.workflow = WF[def] ? def : ((B.workflows || [])[0] || {}).id || '';
            applyWfDefaults();
        }
    }
    function applyWfDefaults() {
        var wf = genWf();
        var d = wfDefaults(wf ? wf.workflow : null);
        S.gen.width = d.width != null ? String(d.width) : '';
        S.gen.height = d.height != null ? String(d.height) : '';
        S.gen.cfg = d.cfg != null ? String(d.cfg) : '';
        S.gen.steps = d.steps != null ? String(d.steps) : '';
    }
    function renderGen() {
        var box = $('#genBody');
        var servers = B.servers || [];
        if (!servers.length) {
            box.innerHTML = '<div class="notice">' + icon('server') + '<div><strong>ComfyUI 서버가 없습니다</strong><span>ComfyUI 서버 메뉴에서 주소(예: http://127.0.0.1:8188)를 저장하세요.</span><a class="btn btn-sm" href="/server">서버 설정</a></div></div>';
            return;
        }
        if (!(B.workflows || []).length) {
            box.innerHTML = '<div class="notice">' + icon('file') + '<div><strong>workflow가 없습니다</strong><span>ComfyUI에서 ‘Export (API)’로 저장한 JSON을 Workflow 메뉴에서 추가하세요.</span><a class="btn btn-sm" href="/workflows">workflow 추가</a></div></div>';
            return;
        }
        var g = S.gen;
        var serverHtml = servers.length > 1
            ? '<select class="input" id="genServer">' + servers.map(function (u, i) { return '<option value="' + esc(u) + '"' + (u === g.server ? ' selected' : '') + '>서버 ' + (i + 1) + ' · ' + esc(u.replace(/^https?:\/\//, '')) + '</option>'; }).join('') + '</select>'
            : '';
        var wfOpts = (B.workflows || []).map(function (w) {
            return '<option value="' + esc(w.id) + '"' + (w.id === g.workflow ? ' selected' : '') + '>' + esc(w.name) + '</option>';
        }).join('');
        var wf = genWf();
        var sum = wf ? wf.summary || {} : {};
        var loras = wf ? wfLoraItems(wf.workflow) : [];
        var ov = (g.wfLora || {})[g.workflow] || {};
        var loraHtml = loras.length ? '<div class="wf-lora"><div class="mini-title">workflow LoRA</div>' + loras.map(function (it) {
            var k = it.node + '|' + it.key, o = ov[k] || {};
            var enabled = o.enabled != null ? o.enabled : it.enabled;
            var strength = o.strength != null ? o.strength : it.strength;
            return '<div class="wf-lora-row' + (enabled ? '' : ' is-off') + '"><span title="' + esc(it.name) + '">' + esc(it.name.split(/[\\/]/).pop().replace(/\.(safetensors|ckpt|pt)$/i, '')) + '</span>' +
                (it.toggle ? '<button type="button" class="toggle-pill' + (enabled ? ' is-on' : '') + '" data-wfl-toggle="' + esc(k) + '">' + (enabled ? 'ON' : 'OFF') + '</button>' : '') +
                '<input class="input strength" type="number" min="0" max="2" step="0.05" value="' + fmtStrength(strength) + '" data-wfl-strength="' + esc(k) + '"></div>';
        }).join('') + '</div>' : '';
        box.innerHTML = serverHtml +
            '<select class="input" id="genWorkflow" title="workflow">' + wfOpts + '</select>' +
            '<div class="wf-sum">' + [sum.size, sum.sampler, sum.positive ? '프롬프트 → ' + sum.positive : ''].filter(Boolean).map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' +
            '<div class="size-row"><label class="mini-field"><span>W</span><input type="number" id="genW" min="64" max="4096" step="8" value="' + esc(g.width) + '"></label>' +
            '<button type="button" class="icon-btn" id="genSwap" title="가로·세로 바꾸기">' + icon('swap') + '</button>' +
            '<label class="mini-field"><span>H</span><input type="number" id="genH" min="64" max="4096" step="8" value="' + esc(g.height) + '"></label></div>' +
            '<div class="gen-grid"><label class="mini-field"><span>CFG</span><input type="number" id="genCfg" min="0" max="50" step="0.5" value="' + esc(g.cfg) + '"></label>' +
            '<label class="mini-field"><span>Steps</span><input type="number" id="genSteps" min="1" max="200" step="1" value="' + esc(g.steps) + '"></label></div>' +
            loraHtml +
            '<div class="gen-run"><div class="stepper" title="생성 장수"><button type="button" data-cnt="-1">' + icon('minus') + '</button><input type="number" id="genCount" min="1" max="20" value="' + esc(g.count || 1) + '"><button type="button" data-cnt="1">' + icon('plus') + '</button></div>' +
            '<button type="button" class="btn btn-primary btn-lg" id="genRun">' + icon('play') + '<span id="genRunLabel">생성</span><kbd>' + (PB.isMac ? '⌘↵' : 'Ctrl+↵') + '</kbd></button></div>' +
            '<div class="builder-comfyui-help" id="genHelp"></div>';
        updateGenButton();
    }
    function updateGenButton() {
        var btn = $('#genRun');
        if (!btn) return;
        var n = parseInt(S.gen.count, 10) || 1;
        $('#genRunLabel').textContent = n > 1 ? n + '장 생성' : '생성';
        btn.disabled = !posOut.value.trim();
    }
    $('#genBody').addEventListener('change', function (e) {
        var t = e.target;
        if (t.id === 'genServer') S.gen.server = t.value;
        else if (t.id === 'genWorkflow') { S.gen.workflow = t.value; applyWfDefaults(); renderGen(); }
        else if (t.hasAttribute('data-wfl-strength')) {
            t.value = fmtStrength(t.value);
            var k = t.getAttribute('data-wfl-strength');
            wfOverride(k).strength = parseFloat(t.value);
        } else if (t.id === 'genCount') {
            S.gen.count = Math.max(1, Math.min(20, parseInt(t.value, 10) || 1));
            t.value = S.gen.count;
            updateGenButton();
        }
        saveState();
    });
    $('#genBody').addEventListener('input', function (e) {
        var map = {genW: 'width', genH: 'height', genCfg: 'cfg', genSteps: 'steps'};
        if (map[e.target.id]) { S.gen[map[e.target.id]] = e.target.value; saveState(); }
    });
    function wfOverride(k) {
        S.gen.wfLora = S.gen.wfLora || {};
        var m = S.gen.wfLora[S.gen.workflow] = S.gen.wfLora[S.gen.workflow] || {};
        return (m[k] = m[k] || {});
    }
    $('#genBody').addEventListener('click', function (e) {
        var t = e.target;
        if (t.closest('#genSwap')) {
            var w = S.gen.width; S.gen.width = S.gen.height; S.gen.height = w;
            $('#genW').value = S.gen.width; $('#genH').value = S.gen.height;
            saveState();
        }
        var c = t.closest('[data-cnt]');
        if (c) {
            S.gen.count = Math.max(1, Math.min(20, (parseInt(S.gen.count, 10) || 1) + parseInt(c.getAttribute('data-cnt'), 10)));
            $('#genCount').value = S.gen.count;
            updateGenButton();
            saveState();
        }
        var tg = t.closest('[data-wfl-toggle]');
        if (tg) {
            var k = tg.getAttribute('data-wfl-toggle');
            var wf = genWf();
            var item = wfLoraItems(wf.workflow).filter(function (x) { return x.node + '|' + x.key === k; })[0];
            var o = wfOverride(k);
            var cur = o.enabled != null ? o.enabled : (item ? item.enabled : true);
            o.enabled = !cur;
            renderGen();
            saveState();
        }
        if (t.closest('#genRun')) generate();
    });
    function numOrNull(v) { v = String(v == null ? '' : v).trim(); if (v === '') return null; var n = parseFloat(v); return Number.isFinite(n) ? n : null; }
    function generate() {
        var pos = posOut.value.trim();
        if (!pos) { PB.toast('프롬프트가 비어 있습니다.', 'warn'); return; }
        var wf = genWf();
        if (!wf) { PB.toast('workflow를 고르세요.', 'warn'); return; }
        var ov = (S.gen.wfLora || {})[S.gen.workflow] || {};
        var strengths = [], enabled = [];
        Object.keys(ov).forEach(function (k) {
            var parts = k.split('|');
            if (ov[k].strength != null) strengths.push({node_id: parts[0], input_key: parts.slice(1).join('|'), strength: fmtStrength(ov[k].strength)});
            if (ov[k].enabled != null) enabled.push({node_id: parts[0], input_key: parts.slice(1).join('|'), enabled: ov[k].enabled !== false});
        });
        var meta = S.template ? TPL[S.template.id] : null;
        var btn = $('#genRun');
        btn.disabled = true;
        var help = $('#genHelp');
        help.className = 'builder-comfyui-help';
        help.textContent = '대기열에 넣는 중…';
        PB.api('/api/comfy/enqueue', {
            comfyui_url: S.gen.server,
            workflow_id: S.gen.workflow,
            positive_prompt: pos,
            negative_prompt: negOut.value.trim(),
            image_count: parseInt(S.gen.count, 10) || 1,
            template_id: meta ? meta.id : null,
            template_label: meta ? meta.title : '',
            style_label: meta ? meta.style : '',
            overrides: {
                generation: {width: numOrNull(S.gen.width), height: numOrNull(S.gen.height), cfg: numOrNull(S.gen.cfg), steps: numOrNull(S.gen.steps)},
                workflow_lora_strengths: strengths,
                workflow_lora_enabled: enabled
            },
            builder_state: S
        }).then(function (d) {
            btn.disabled = false;
            if (!d || !d.ok) {
                help.className = 'builder-comfyui-help is-error';
                help.textContent = (d && d.message) || '대기열에 넣지 못했습니다.';
                return;
            }
            var n = parseInt(S.gen.count, 10) || 1;
            help.textContent = n + '장을 대기열에 넣었습니다.';
            PB.toast(n + '장 생성을 시작합니다.');
            PB.setJobs(d);
        });
    }

    /* 작업 목록 · 최근 결과 */
    var lastJobs = [], jobsSig = null;
    function renderJobs(data) {
        lastJobs = (data && data.jobs) || [];
        var active = lastJobs.filter(function (j) { return j.status === 'running' || j.status === 'queued'; })
            .sort(function (a, b) { return (a.status === 'running' ? 0 : 1) - (b.status === 'running' ? 0 : 1) || a.id - b.id; });
        var failed = lastJobs.filter(function (j) { return j.status === 'failed'; }).slice(0, 3);
        // 작업이 그대로면 목록을 다시 그리지 않는다 (누르려던 취소 버튼이 바뀌지 않고, 스크롤도 그대로)
        var sig = active.concat(failed).map(function (j) { return j.id + j.status; }).join(',');
        if (sig !== jobsSig) { jobsSig = sig; renderJobLines(active, failed); }
        renderRecent(data);
    }
    function renderJobLines(active, failed) {
        var lines = active.map(function (j) {
            var running = j.status === 'running';
            var since = running ? PB.parseTime(j.started_at) : 0;
            return '<div class="job-line ' + (running ? 'is-running' : 'is-queued') + '">' + (running ? '<span class="spinner"></span>' : '') +
                '<span class="job-state">' + (running ? '생성 중' : '대기 ' + j.queue_position) + '</span>' +
                '<span class="job-text" title="' + esc(j.positive_prompt) + '">' + esc(j.template_label || j.workflow_name || '프롬프트') + '</span>' +
                (running ? '<span class="job-time" data-since="' + since + '">' + PB.duration((PB.serverNow() - since) / 1000) + '</span>' : '') +
                '<button type="button" class="icon-btn sm" data-job-cancel="' + j.id + '" title="' + (running ? '중단' : '취소') + '">' + icon(running ? 'stop' : 'x') + '</button></div>';
        }).join('');
        lines += failed.map(function (j) {
            return '<div class="job-line is-failed"><span class="job-state">실패</span><span class="job-text" title="' + esc(j.error_message || '') + '">' + esc(j.error_message || '알 수 없는 오류') + '</span>' +
                '<button type="button" class="icon-btn sm" data-job-retry="' + j.id + '" title="다시 시도">' + icon('refresh') + '</button>' +
                '<button type="button" class="icon-btn sm" data-job-delete="' + j.id + '" title="지우기">' + icon('x') + '</button></div>';
        }).join('');
        var box = $('#jobLines'), list = box.querySelector('.job-list'), top = list ? list.scrollTop : 0;
        box.innerHTML = lines ? '<div class="job-list">' + lines + '</div>' : '';
        list = box.querySelector('.job-list');
        if (list) list.scrollTop = top;
    }
    function renderRecent(data) {
        var images = [];
        lastJobs.forEach(function (j) {
            if (j.status !== 'completed') return;
            (j.images || []).forEach(function (im) { images.push({job: j, url: im.url, thumb: im.thumb || im.url}); });
        });
        var recent = images.slice(0, 9);
        var grid = $('#recentGrid');
        var html = recent.map(function (r) {
            return '<a href="/gallery#job-' + r.job.id + '" data-view="' + esc(r.url) + '" title="' + esc(r.job.template_label || '') + '"><img src="' + esc(r.thumb) + '" alt="" loading="lazy"></a>';
        }).join('') || '<div class="faint recent-empty">생성한 이미지가 여기에 표시됩니다.</div>';
        if (grid.getAttribute('data-html') !== html) { grid.innerHTML = html; grid.setAttribute('data-html', html); }
        var servers = (data && data.servers) || [];
        var cur = servers.filter(function (s) { return s.url === S.gen.server; })[0] || servers[0];
        var st = $('#genServerState');
        if (st) {
            st.textContent = cur ? (cur.ok === true ? '● 연결됨' : (cur.ok === false ? '● 연결 안 됨' : '')) : '';
            st.className = 'sub ' + (cur && cur.ok === true ? 'is-ok' : (cur && cur.ok === false ? 'is-bad' : ''));
            st.title = cur && cur.message ? cur.message : (cur ? cur.url : '');
        }
    }
    window.addEventListener('pb:jobs', function (e) { renderJobs(e.detail); });
    setInterval(function () {
        $$('#jobLines [data-since]').forEach(function (el) {
            el.textContent = PB.duration((PB.serverNow() - parseInt(el.getAttribute('data-since'), 10)) / 1000);
        });
    }, 1000);
    $('#jobLines').addEventListener('click', function (e) {
        var c = e.target.closest('[data-job-cancel]');
        if (c) {
            var id = parseInt(c.getAttribute('data-job-cancel'), 10);
            var job = lastJobs.filter(function (j) { return j.id === id; })[0];
            var go = function () { PB.api('/api/comfy/cancel', {job_id: id}).then(PB.setJobs); };
            if (job && job.status === 'running') PB.confirm('생성을 중단할까요?', 'ComfyUI에서 진행 중인 생성을 멈추고 다음 대기 작업을 시작합니다.', {confirmText: '중단'}).then(function (ok) { if (ok) go(); });
            else go();
            return;
        }
        var d = e.target.closest('[data-job-delete]');
        if (d) PB.api('/api/comfy/delete', {job_id: parseInt(d.getAttribute('data-job-delete'), 10)}).then(PB.setJobs);
        var r = e.target.closest('[data-job-retry]');
        if (r) {
            var rid = parseInt(r.getAttribute('data-job-retry'), 10);
            PB.api('/api/comfy/regenerate', {job_id: rid}).then(function (data) {
                PB.api('/api/comfy/delete', {job_id: rid}).then(PB.setJobs);
                PB.setJobs(data);
            });
        }
    });
    $('#recentGrid').addEventListener('click', function (e) {
        var a = e.target.closest('[data-view]');
        if (!a) return;
        e.preventDefault();
        PB.viewImage(a.getAttribute('data-view'), a.title);
    });

    /* ================================================================ 도크 토글 · 단축키 */
    $('#dockToggle').addEventListener('click', function () { $('#app').classList.toggle('dock-open'); });
    document.addEventListener('keydown', function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); generate(); return; }
        if ((e.metaKey || e.ctrlKey) && /^[1-5]$/.test(e.key) && !document.body.classList.contains('has-overlay')) {
            e.preventDefault();
            setTab(['template', 'person', 'outfit', 'background', 'camera'][parseInt(e.key, 10) - 1]);
        }
    });

    /* ================================================================ 시작 */
    function renderAll() {
        renderTemplateDetail();
        renderPerson();
        renderOutfit();
        renderBackground();
        renderCamera();
        renderGen();
        markSelectedCard();
    }
    ensureGenDefaults();
    buildTemplateGrid();
    renderAll();
    setTab(B.tab || S.tab || 'template');
    update({noSave: true});
    if (B.openTemplate && TPL[B.openTemplate]) {
        S.tplFilter.style = ''; S.tplFilter.q = '';
        $$('#tplStyle .style-btn').forEach(function (x) { x.classList.toggle('is-active', !x.getAttribute('data-style')); });
        $('#tplSearch').value = '';
        filterTemplates();
        S.template = null;
        B.tab = 'template';
        setTab('template');
        selectTemplate(B.openTemplate).then(function () {
            var c = $('.tcard.is-selected', tplGrid);
            if (c) c.scrollIntoView({block: 'center'});
        });
        history.replaceState(null, '', '/builder');
    } else if (S.template && TPL[S.template.id]) {
        selectTemplate(S.template.id, true).then(function () {
            var c = $('.tcard.is-selected', tplGrid);
            if (c) c.scrollIntoView({block: 'center'});
        });
    } else if (S.template) {
        S.template = null;
    }
    if (B.restoredFromJob) {
        saveState();
        PB.toast('생성 기록의 선택값을 불러왔습니다.');
        history.replaceState(null, '', '/builder');
    }
    if (PB.jobs()) renderJobs(PB.jobs());
})();
