"""페이지 HTML. 화면 대부분은 JS가 부트 데이터(PB_BOOT)로 그린다."""
from __future__ import annotations

import json

from . import brand, comfy, host, paths, repo, settings, state, storage
from .ui import h, icon, layout

OUTFIT_MODES = [
    ("complete", "완성 의상"),
    ("two_piece", "상의 + 하의"),
    ("dress", "원피스 / 드레스"),
    ("outer", "아우터 포함"),
]
# 의상 직접 구성: 섹션 → 보이는 구성 방식
OUTFIT_MODE_MAP = [
    ("착의 상태", "complete,two_piece,dress,outer"),
    ("의상 구성", "complete"),
    ("상의", "two_piece,outer"),
    ("하의", "two_piece,outer"),
    ("원피스/드레스", "dress"),
    ("겉옷", "outer"),
    ("전체 색상", "complete,dress,outer"),
    ("상의 색상", "two_piece"),
    ("하의 색상", "two_piece"),
    ("전체 소재", "complete,dress,outer"),
    ("상의 소재", "two_piece"),
    ("하의 소재", "two_piece"),
    ("핏/실루엣", "complete,two_piece,dress,outer"),
    ("의상 장식", "complete,two_piece,dress,outer"),
    ("다리 착용물", "complete,two_piece,dress,outer"),
    ("신발 종류", "complete,two_piece,dress,outer"),
    ("신발 상태", "complete,two_piece,dress,outer"),
]
ACCESSORY_STEPS = [("악세사리 카테고리", "category"), ("악세사리 위치", "position"),
                   ("악세사리 방향", "direction"), ("악세사리 디자인", "design")]
TATTOO_STEPS = [("타투 위치", "position"), ("타투 방향", "direction"), ("타투 스타일", "style"), ("타투 디테일", "detail")]
ART_STYLES = [("반실사 Semi-realistic", "(Semi-realistic:1.2)"), ("사실적인 Realistic", "(Realistic:1.2)"),
              ("사진 같은 Photorealistic", "(Photorealistic:1.2)")]


def _groups(d: dict) -> list[dict]:
    return [{"label": k, "items": [{"id": e["id"], "label": e["label"], "prompt": e["prompt"],
                                    "parent": e.get("parent_label", "")} for e in v]}
            for k, v in d.items() if v]


def builder_boot(restore_state=None, tab: str = "", open_template: int = 0) -> dict:
    cfg = settings.load()
    rows = repo.fetch_template_rows()
    # 제작순 순위
    by_created = sorted(rows, key=lambda r: (str(r.get("created_at") or ""), r["id"]), reverse=True)
    created_rank = {r["id"]: i for i, r in enumerate(by_created)}
    templates = []
    style_counts: dict[int, int] = {}
    for r in rows:
        templates.append({
            "id": r["id"], "title": r["label_ko"].strip() or "이름 없는 템플릿", "style_id": r["style_id"],
            "style": r["style_label"] or "", "image": r["image"],
            "maker": r["maker_name"], "new": repo.new_badge_day(r["created_at"]), "cr": created_rank[r["id"]],
        })
        if r["style_id"]:
            style_counts[r["style_id"]] = style_counts.get(r["style_id"], 0) + 1
    templates.sort(key=lambda t: (repo.natural_key(t["title"]), t["id"]))
    styles = [{"id": s["id"], "label": s["label_ko"], "count": style_counts.get(s["id"], 0)}
              for s in repo.fetch_styles() if style_counts.get(s["id"])]

    ext = repo.fetch_extension_elements()
    outfit = []
    for label, modes in OUTFIT_MODE_MAP:
        items = ext["outfit"].get(label) or []
        if items:
            outfit.append({"label": label, "modes": modes.split(","),
                           "items": [{"id": e["id"], "label": e["label"], "prompt": e["prompt"]} for e in items]})

    def steps(groups, defs):
        return [{"key": key, "label": label, "items": [{"id": e["id"], "label": e["label"], "prompt": e["prompt"],
                                                         "parent": e["parent_label"]} for e in groups.get(label, [])]}
                for label, key in defs if groups.get(label)]

    render_groups = repo.fetch_render_elements()
    loras = repo.fetch_loras()
    workflows = []
    for wf in comfy.list_workflows(include_json=True):
        try:
            data = json.loads(wf["json"])
        except ValueError:
            continue
        workflows.append({"id": wf["id"], "name": wf["name"], "file_name": wf["file_name"],
                          "summary": wf["summary"], "workflow": data})
    saved = restore_state if isinstance(restore_state, dict) else state.load()
    return {
        "templates": templates,
        "styles": styles,
        "person": {k: _groups(v) for k, v in repo.fetch_person_elements().items()},
        "outfitModes": [{"value": v, "label": l} for v, l in OUTFIT_MODES],
        "outfit": outfit,
        "pose": _groups(ext["pose"]),
        "accessory": steps(ext["accessory"], ACCESSORY_STEPS),
        "tattoo": steps(ext["tattoo"], TATTOO_STEPS),
        "artStyles": [{"label": l, "prompt": p} for l, p in ART_STYLES],
        "camera": _groups(repo.fetch_camera_elements()),
        "render": _groups(render_groups),
        "placeSlots": [{"key": s["slot_key"], "label": s["label"], "options": s["options"]}
                       for s in repo.fetch_place_slots() if s["slot_key"] and s["options"]],
        "loras": [{"id": l["idx"], "title": l["title"], "support": l["support_type"], "prompt": l["prompt"],
                   "url": l.get("url") or "", "filename": l["filename"],
                   "strength": float(l["default_strength"] or 1)} for l in loras],
        "workflows": workflows,
        "servers": cfg["comfy_servers"],
        "settings": {"timeout": cfg["timeout_minutes"], "defaultWorkflow": cfg["default_workflow_id"],
                     "outfitModel": cfg["outfit_model"], "placesModel": cfg["places_model"]},
        "state": saved,
        "restoredFromJob": bool(restore_state),
        "tab": tab,
        "openTemplate": open_template,
    }


STEPS = [
    ("template", "템플릿", "layers"),
    ("person", "인물", "user"),
    ("outfit", "의상 · 포즈", "shirt"),
    ("background", "배경", "mountain"),
    ("camera", "카메라 · LoRA", "camera"),
]


def builder_page(restore_state=None, tab: str = "", open_template: int = 0) -> str:
    steps = "".join(
        f'<button type="button" class="step" data-tab="{k}" role="tab">'
        f'<span class="step-n">{i}</span><span class="step-label">{h(label)}</span><span class="step-dot"></span></button>'
        for i, (k, label, _ic) in enumerate(STEPS, 1))
    topbar = f"""
    <div class="topbar builder-topbar">
      <nav class="steps" role="tablist" id="steps">{steps}</nav>
      <div class="spacer"></div>
      <button type="button" class="btn btn-ghost" id="resetAllBtn" title="모든 선택 초기화">{icon('refresh')}전체 초기화</button>
      <button type="button" class="icon-btn dock-toggle" id="dockToggle" title="프롬프트 · 생성 패널">{icon('panel')}</button>
    </div>"""
    body = f"""
    <div class="content" id="builderContent">
      <section class="builder-tab-panel" data-panel="template">
        <div class="tpl-layout">
          <div class="tpl-browser">
            <div class="tpl-filters">
              <div class="tpl-styles" id="tplStyle" role="group" aria-label="스타일"></div>
              <div class="search-wrap tpl-search">{icon('search')}<input class="input" id="tplSearch" type="search" placeholder="템플릿 검색" autocomplete="off" spellcheck="false"></div>
              <div class="seg" id="tplSort"><button type="button" data-sort="name" class="is-active">이름순</button><button type="button" data-sort="new">최신순</button></div>
              <button type="button" class="icon-btn" id="tplRandom" title="보이는 템플릿 중 랜덤">{icon('dice')}</button>
              <button type="button" class="btn btn-ghost" id="tplReset" title="고른 템플릿과 세부 항목을 지우고 템플릿 없이 조합합니다">{icon('refresh')}초기화</button>
            </div>
            <div class="tpl-meta" id="tplMeta"></div>
            <div class="tpl-grid" id="tplGrid"></div>
          </div>
          <aside class="tpl-detail card" id="tplDetail"></aside>
        </div>
      </section>
      <section class="builder-tab-panel" data-panel="person"><div class="panel-grid" id="personPanel"></div></section>
      <section class="builder-tab-panel" data-panel="outfit"><div class="panel-grid" id="outfitPanel"></div></section>
      <section class="builder-tab-panel" data-panel="background"><div class="panel-grid bg-grid" id="backgroundPanel"></div></section>
      <section class="builder-tab-panel" data-panel="camera"><div class="panel-grid" id="cameraPanel"></div></section>
    </div>"""
    dock = f"""
  <aside class="dock" id="dock">
    <section class="dock-section dock-prompt">
      <div class="dock-head">
        <h2>프롬프트</h2><span class="sub" id="promptMode">자동 조합</span>
        <div class="actions">
          <button type="button" class="btn btn-sm btn-ghost" id="promptRevert" hidden title="선택값으로 다시 조합">{icon('undo')}자동으로</button>
        </div>
      </div>
      <div class="piece-chips" id="pieceChips"></div>
      <div class="prompt-label">Positive <span class="count" id="posCount"></span>
        <button type="button" class="btn btn-sm" id="copyPos" title="Positive 복사">{icon('copy')}복사</button></div>
      <textarea class="textarea pb-builder-output" id="posOut" spellcheck="false" placeholder="템플릿을 고르거나 항목을 선택하면 여기에 조합됩니다."></textarea>
      <div class="prompt-label">Negative
        <button type="button" class="btn btn-sm" id="copyNeg" title="Negative 복사">{icon('copy')}복사</button></div>
      <textarea class="textarea" id="negOut" spellcheck="false" placeholder="Negative Prompt"></textarea>
      <details class="extra-box" id="extraBox">
        <summary>{icon('plus')}추가 입력 <span class="faint" id="extraHint"></span></summary>
        <textarea class="textarea" id="extraPos" spellcheck="false" placeholder="Positive 끝에 덧붙일 내용"></textarea>
        <textarea class="textarea" id="extraNeg" spellcheck="false" placeholder="Negative 끝에 덧붙일 내용"></textarea>
      </details>
    </section>
    <section class="dock-section dock-gen" id="genSection">
      <div class="dock-head"><h2>ComfyUI 생성</h2><span class="sub" id="genServerState"></span>
        <div class="actions"><a class="btn btn-sm btn-ghost" href="/server" title="ComfyUI 서버 설정">{icon('gear')}</a></div></div>
      <div id="genBody"></div>
    </section>
    <section class="dock-section dock-results">
      <div class="dock-head"><h2>최근 결과</h2><div class="actions"><a class="btn btn-sm btn-ghost" href="/gallery">갤러리{icon('chevron-right')}</a></div></div>
      <div id="jobLines"></div>
      <div class="recent-grid" id="recentGrid"></div>
    </section>
  </aside>"""
    return layout("builder", "빌더", body, topbar=topbar, dock=dock, scripts=["js/builder.js"],
                  boot=builder_boot(restore_state, tab, open_template))


# ---------------------------------------------------------------- 갤러리

def gallery_page() -> str:
    topbar = f"""
    <div class="topbar">
      <h1>갤러리</h1>
      <div class="seg" id="galFilter">
        <button type="button" data-f="all" class="is-active">전체 <span class="n" id="galCountAll"></span></button>
        <button type="button" data-f="failed">실패 <span class="n" id="galCountFailed"></span></button>
      </div>
      <div class="search-wrap gal-search">{icon('search')}<input class="input" id="galSearch" type="search" placeholder="프롬프트 · 템플릿 검색" autocomplete="off" spellcheck="false"></div>
      <div class="spacer"></div>
      <div class="size-ctl" id="galSize" title="미리보기 크기">
        <button type="button" class="icon-btn sm" id="galZoomOut" title="작게">{icon('minus')}</button>
        <input type="range" id="galZoom" min="50" max="250" step="10" value="100" aria-label="미리보기 크기">
        <button type="button" class="icon-btn sm" id="galZoomIn" title="크게">{icon('plus')}</button>
        <button type="button" class="size-val" id="galZoomVal" title="100%로">100%</button>
      </div>
      <button type="button" class="btn" id="galSelectBtn">{icon('check')}선택</button>
      <button type="button" class="btn" id="galOpenFolder">{icon('folder')}폴더 열기</button>
    </div>"""
    body = f"""
    <div class="content gallery-content">
      <div class="gal-active" id="galActive"></div>
      <div class="gal-selectbar" id="galSelectBar" hidden>
        <span id="galSelCount">0개 선택</span>
        <button type="button" class="btn btn-sm" id="galSelAll">전체 선택</button>
        <button type="button" class="btn btn-sm btn-danger" id="galSelDelete">{icon('trash')}삭제</button>
        <div class="spacer"></div>
        <button type="button" class="btn btn-sm btn-ghost" id="galSelDone">완료</button>
      </div>
      <div class="gal-grid size-m" id="galGrid"></div>
      <div class="gal-empty" id="galEmpty" hidden></div>
    </div>"""
    cfg = settings.load()
    return layout("gallery", "갤러리", body, topbar=topbar, scripts=["js/gallery.js"],
                  boot={"servers": cfg["comfy_servers"]})


# ---------------------------------------------------------------- 템플릿 만들기

def style_items() -> list[dict]:
    """템플릿 스타일 (스타일 관리 · 목록 필터용)."""
    return [{"id": s["id"], "label": s["label_ko"], "total": s["total"]} for s in repo.fetch_styles()]


def templates_page() -> str:
    topbar = f"""
    <div class="topbar">
      <h1>템플릿 만들기</h1>
      <span class="chip" id="tlCount"></span>
      <select class="input" id="tlStyle" style="width:180px"></select>
      <div class="search-wrap" style="width:220px">{icon('search')}<input class="input" id="tlSearch" type="search" placeholder="제목 · 태그 검색" autocomplete="off" spellcheck="false"></div>
      <div class="seg" id="tlSort"><button type="button" data-s="name" class="is-active">이름순</button><button type="button" data-s="new">최신순</button></div>
      <div class="spacer"></div>
      <button type="button" class="btn" id="tlStyles" title="스타일 추가 · 이름 바꾸기 · 삭제">{icon('palette')}스타일 관리</button>
      <a class="btn btn-primary" href="/templates/new">{icon('plus')}새 템플릿</a>
    </div>"""
    body = """<div class="content"><div class="tl-grid" id="tlGrid"></div><div class="gal-empty" id="tlEmpty" hidden>조건에 맞는 템플릿이 없습니다.</div></div>"""
    return layout("templates", "템플릿 만들기", body, topbar=topbar, scripts=["js/templates.js"],
                  boot={"mode": "list", "templates": repo.template_list(), "styles": style_items()})


def template_editor_page(data: dict | None) -> str:
    is_new = data is None
    title = "새 템플릿" if is_new else (data.get("title") or "템플릿 편집")
    topbar = f"""
    <div class="topbar">
      <a class="icon-btn" href="/templates" title="목록으로">{icon('chevron-left')}</a>
      <h1 id="edTitleHead">{h(title)}</h1>
      <div class="seg" id="edTabs"><button type="button" data-t="basic" class="is-active">기본 정보</button><button type="button" data-t="details">세부 항목 <span class="n" id="edVarCount"></span></button></div>
      <div class="spacer"></div>
      {'' if is_new else f'<button type="button" class="btn btn-ghost" id="edUse">{icon("wand")}빌더에서 쓰기</button>'}
      <button type="button" class="btn" id="edSaveStay">{icon('check')}저장</button>
      <button type="button" class="btn btn-primary" id="edSave">저장 후 목록</button>
    </div>"""
    body = """<div class="content"><div class="editor" id="editor"></div></div>"""
    return layout("templates", title, body, topbar=topbar, scripts=["js/templates.js"],
                  boot={"mode": "edit", "template": data,
                        "styles": [{"id": s["id"], "label": s["label_ko"]} for s in repo.selectable_styles()],
                        "loras": [{"id": l["idx"], "title": l["title"], "support": l["support_type"]}
                                  for l in repo.fetch_loras()]})


# ---------------------------------------------------------------- 설정

def settings_boot() -> dict:
    cfg = settings.load()
    return {
        "settings": cfg,
        "workflows": comfy.list_workflows(include_json=False),
        "loras": repo.fetch_loras(active_only=False),
        "paths": {"data": str(paths.DATA_DIR), "outputs": str(paths.OUTPUT_DIR), "workflows": str(paths.WORKFLOW_DIR),
                  "db": str(paths.DB_PATH), "log": str(paths.LOG_PATH)},
        "storage": storage.info(),
        "version": paths.APP_VERSION,
        "brand": brand.boot(),
        "canRestart": host.has("restart"),
    }


# 예전 설정 화면의 메뉴: 이제 메인 메뉴(사이드바)에 하나씩 있다
SETTINGS_SECTIONS = {"server": "ComfyUI 서버", "workflows": "Workflow", "lora": "LoRA",
                     "data": "데이터", "help": "도움말", "about": "정보"}


def settings_page(section: str = "server") -> str:
    section = section if section in SETTINGS_SECTIONS else "server"
    label = SETTINGS_SECTIONS[section]
    body = """<div class="content"><div class="settings" id="settings"></div></div>"""
    topbar = f"""<div class="topbar"><h1>{h(label)}</h1><div class="spacer"></div></div>"""
    return layout(section, label, body, topbar=topbar, scripts=["js/settings.js"],
                  boot={**settings_boot(), "section": section})


def settings_redirect_page() -> str:
    """/settings#lora 같은 예전 주소 → /lora (주소의 # 뒤는 브라우저만 안다)."""
    keys = json.dumps(list(SETTINGS_SECTIONS))
    return ("<!doctype html><meta charset='utf-8'><script>"
            f"var k = location.hash.slice(1), keys = {keys};"
            "location.replace(k === 'styles' ? '/templates#styles' : '/' + (keys.indexOf(k) >= 0 ? k : 'server'));</script>")


# ---------------------------------------------------------------- 프롬프트 요소

def elements_page() -> str:
    topbar = f"""
    <div class="topbar">
      <h1>프롬프트 요소</h1>
      <span class="chip" id="elCount"></span>
      <div class="search-wrap" style="width:240px">{icon('search')}<input class="input" id="elSearch" type="search" placeholder="이름 · 프롬프트 검색 (전체 종류)" autocomplete="off" spellcheck="false"></div>
      <div class="spacer"></div>
      <a class="btn btn-ghost" href="/data" title="종류별 내보내기 · 가져오기">{icon('database')}내보내기 · 가져오기</a>
      <button type="button" class="btn btn-primary" id="elAdd">{icon('plus')}요소 추가</button>
    </div>"""
    body = """<div class="content"><div class="el-layout" id="elements"></div></div>"""
    return layout("elements", "프롬프트 요소", body, topbar=topbar, scripts=["js/elements.js"],
                  boot={"items": repo.element_list(), "types": repo.element_types()})


def error_page(message: str) -> str:
    body = f'<div class="content"><div class="card" style="max-width:560px"><div class="card-title">{icon("alert")}오류</div><p class="muted">{h(message)}</p><a class="btn" href="/builder">빌더로</a></div></div>'
    return layout("", "오류", body)
