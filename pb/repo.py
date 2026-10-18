"""DB 조회·저장. 원본 Builder.php / CreateTemplate.php / get_prompt_template_item.php 로직을 옮겼다."""
from __future__ import annotations

import base64
import json
import re
import secrets
import time
from datetime import datetime

from . import db, paths


def clean_label(value) -> str:
    return str(value or "").replace("_", " ").strip()


def ko_key(value) -> str:
    return str(value or "").lower()


def natural_key(value):
    parts = re.split(r"(\d+)", str(value or "").lower())
    return [int(p) if p.isdigit() else p for p in parts]


def media_url(image_url: str) -> str:
    """DB의 image_url('template_preview/a.webp')을 화면용 주소로."""
    u = str(image_url or "").strip()
    if not u:
        return ""
    if u.startswith(("http://", "https://", "/")):
        return u
    u = re.sub(r"^(?:\./)?_upload/", "", u)
    if "/" not in u:
        u = "template_preview/" + u
    return "/media/" + u


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# ---------------------------------------------------------------- 빌더 요소

def _is_age(label: str, section: str) -> bool:
    return bool(re.search(r"(age|나이)", (label + " " + section).lower()))


def fetch_person_elements() -> dict:
    groups = {"person": {}, "makeup": {}, "hair": {}}
    for r in db.rows("SELECT * FROM prompt_elements WHERE element_type IN ('person','makeup','hair') "
                     "AND COALESCE(is_active,1)=1 ORDER BY id ASC"):
        section = r["element_type"]
        label = (r["label_ko"] or "").strip()
        prompt = (r["prompt"] or "").strip()
        if not label and not prompt:
            continue
        label = label or prompt
        prompt = prompt or label
        if _is_age(label, r["section"] or ""):
            continue
        cond = clean_label(r["section"]) or {"makeup": "메이크업", "hair": "머리스타일"}.get(section, "기본설정")
        groups[section].setdefault(cond, []).append({"id": r["id"], "label": clean_label(label), "prompt": prompt})
    return groups


def fetch_extension_elements() -> dict:
    groups = {"outfit": {}, "pose": {}, "accessory": {}, "tattoo": {}}
    for r in db.rows("SELECT * FROM prompt_elements WHERE element_type IN ('outfit','pose','accessory','tattoo') "
                     "AND COALESCE(is_active,1)=1 ORDER BY element_type, section, parent_label, sort_order, id"):
        label = (r["label_ko"] or "").strip()
        prompt = (r["prompt"] or "").strip()
        if not label and not prompt:
            continue
        section = clean_label(r["section"]) or r["element_type"]
        groups[r["element_type"]].setdefault(section, []).append({
            "id": r["id"], "parent_label": clean_label(r["parent_label"]),
            "label": clean_label(label or prompt), "prompt": prompt or label})
    return groups


def fetch_camera_elements() -> dict:
    groups: dict = {}
    for r in db.rows("SELECT * FROM prompt_elements WHERE element_type='camera' AND COALESCE(is_active,1)=1 "
                     "ORDER BY section, parent_label, sort_order, id"):
        label = (r["label_ko"] or "").strip()
        prompt = (r["prompt"] or "").strip()
        if not label and not prompt:
            continue
        section = clean_label(r["section"]) or "카메라"
        display = clean_label(label or prompt)
        parent = clean_label(r["parent_label"])
        if parent:
            display = f"{parent} - {display}"
        groups.setdefault(section, []).append({"id": r["id"], "label": display, "prompt": prompt or label})
    return groups


def fetch_render_elements() -> dict:
    groups: dict = {}
    for r in db.rows("SELECT * FROM prompt_elements WHERE element_type IN "
                     "('render','rendering','quality_render','quality','render_quality') AND COALESCE(is_active,1)=1 "
                     "ORDER BY section, sort_order, id"):
        label = (r["label_ko"] or "").strip()
        prompt = (r["prompt"] or "").strip()
        if not label and not prompt:
            continue
        section = clean_label(r["section"] or "렌더링")
        groups.setdefault(section, []).append({"id": r["id"], "label": clean_label(label or prompt),
                                               "prompt": prompt or label})
    return groups


def default_render_prompt(groups: dict) -> str:
    out = []
    for items in groups.values():
        if items and items[0]["prompt"].strip() and items[0]["prompt"].strip() not in out:
            out.append(items[0]["prompt"].strip())
    return ", ".join(out)


def fetch_famous_places() -> list[dict]:
    return db.rows("SELECT * FROM prompt_famous_places WHERE COALESCE(is_active,1)=1 "
                   "ORDER BY country_ko, place_type_ko, label_ko")


def fetch_place_slots() -> list[dict]:
    slots: dict = {}
    for r in db.rows("""
        SELECT s.id AS slot_id, s.slot_key, s.label_ko AS slot_label, o.id AS option_id, o.label_ko AS option_label,
               o.value_prompt, o.is_default
        FROM prompt_famous_place_slots s
        LEFT JOIN prompt_famous_place_slot_options o ON o.slot_id = s.id AND COALESCE(o.is_active,1)=1
        WHERE COALESCE(s.is_active,1)=1
        ORDER BY s.sort_order, s.label_ko, o.sort_order, o.label_ko"""):
        s = slots.setdefault(r["slot_id"], {"slot_key": r["slot_key"] or "", "label": clean_label(r["slot_label"]),
                                            "options": []})
        if r["option_id"]:
            s["options"].append({"label": clean_label(r["option_label"]), "prompt": r["value_prompt"] or "",
                                 "is_default": int(r["is_default"] or 0)})
    return list(slots.values())


# ---------------------------------------------------------------- LoRA

def lora_prompt_line(r: dict) -> str:
    name = re.sub(r"\.safetensors$", "", str(r.get("filename") or "").strip(), flags=re.I)
    strength = str(r.get("default_strength") if r.get("default_strength") is not None else "1").strip() or "1"
    try:
        strength = f"{float(strength):g}"
    except ValueError:
        strength = "1"
    trigger = str(r.get("trigger_text") or "").strip()
    line = f"<lora:{name}:{strength}>" if name else ""
    if trigger:
        line += (", " if line else "") + trigger
    return line


def fetch_loras(active_only: bool = True) -> list[dict]:
    where = "WHERE COALESCE(is_active,1)=1" if active_only else ""
    items = []
    for r in db.rows(f"SELECT * FROM prompt_lora {where} ORDER BY title COLLATE NOCASE, idx"):
        title = (r["title"] or "").strip()
        filename = (r["filename"] or "").strip()
        if not title and not filename:
            continue
        items.append({**r, "title": clean_label(title or filename), "support_type": clean_label(r["support_type"]),
                      "prompt": lora_prompt_line(r)})
    return items


def save_lora(data: dict) -> int:
    title = str(data.get("title") or "").strip()
    filename = str(data.get("filename") or "").strip()
    if not filename:
        raise ValueError("LoRA 파일명을 입력하세요.")
    if not title:
        title = re.sub(r"\.safetensors$", "", filename, flags=re.I)
    try:
        strength = max(0.0, min(2.0, float(data.get("default_strength") or 1)))
    except (TypeError, ValueError):
        strength = 1.0
    values = (title, str(data.get("support_type") or "").strip(), filename, strength,
              str(data.get("trigger_text") or "").strip(), str(data.get("description") or "").strip(),
              str(data.get("url") or "").strip(), 1 if data.get("is_active", True) else 0)
    lid = int(data.get("idx") or 0)
    if lid > 0:
        db.execute("UPDATE prompt_lora SET title=?, support_type=?, filename=?, default_strength=?, trigger_text=?, "
                   "description=?, url=?, is_active=?, updated_at=? WHERE idx=?", values + (now(), lid))
        return lid
    cur = db.execute("INSERT INTO prompt_lora (title, support_type, filename, default_strength, trigger_text, "
                     "description, url, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?)", values + (now(),))
    return int(cur.lastrowid)


def delete_lora(idx: int) -> None:
    db.execute("DELETE FROM prompt_lora WHERE idx = ?", (idx,))


# ---------------------------------------------------------------- 프롬프트 요소 관리 (등록 · 수정 · 삭제)

# (element_type, 이름, 빌더에서 보이는 곳, 새 그룹을 만들 수 있는지)
# 의상 · 악세사리 · 타투는 빌더의 그룹 구성이 정해져 있어(pages.OUTFIT_MODE_MAP 등) 있는 그룹에만 넣는다
ELEMENT_TYPES = [
    ("person", "인물", "빌더 › 인물", True),
    ("makeup", "메이크업", "빌더 › 인물", True),
    ("hair", "헤어", "빌더 › 인물", True),
    ("outfit", "의상", "빌더 › 의상 · 포즈", False),
    ("pose", "포즈", "빌더 › 의상 · 포즈", True),
    ("accessory", "악세사리", "빌더 › 의상 · 포즈", False),
    ("tattoo", "타투", "빌더 › 의상 · 포즈", False),
    ("camera", "카메라", "빌더 › 카메라 · LoRA", True),
    ("quality_render", "렌더링 품질", "빌더 › 카메라 · LoRA", True),
]
_TYPE_INFO = {k: (label, where, free) for k, label, where, free in ELEMENT_TYPES}


def element_type_label(key: str) -> str:
    return _TYPE_INFO.get(key, (key,))[0] or key


def element_types() -> list[dict]:
    """알려진 종류 + DB에만 있는 종류, 종류마다 요소 수."""
    counts = {r["element_type"]: r["n"] for r in db.rows(
        "SELECT element_type, COUNT(*) AS n FROM prompt_elements GROUP BY element_type")}
    out = [{"key": k, "label": label, "where": where, "free": free, "count": counts.get(k, 0)}
           for k, label, where, free in ELEMENT_TYPES]
    out += [{"key": k, "label": k, "where": "", "free": True, "count": n}
            for k, n in sorted(counts.items()) if k not in _TYPE_INFO]
    return out


def element_list() -> list[dict]:
    """전체 요소 (사용 안 함 포함). 종류 안에서 그룹은 처음 만든 순서, 그룹 안에서는 정렬 순서."""
    rows = db.rows("SELECT id, element_type, section, COALESCE(parent_label,'') AS parent_label, label_ko, prompt, "
                   "sort_order, is_active FROM prompt_elements ORDER BY id")
    first: dict[tuple, int] = {}
    for r in rows:
        first.setdefault((r["element_type"], r["section"]), r["id"])
    rows.sort(key=lambda r: (r["element_type"], first[(r["element_type"], r["section"])], r["sort_order"], r["id"]))
    return rows


def save_element(data: dict) -> int:
    eid = int(data.get("id") or 0)
    etype = str(data.get("element_type") or "").strip()
    section = str(data.get("section") or "").strip()
    parent = str(data.get("parent_label") or "").strip()
    label = str(data.get("label_ko") or "").strip()
    prompt = str(data.get("prompt") or "").strip()
    active = 0 if data.get("is_active", True) in (False, 0, "0") else 1
    if not etype:
        raise ValueError("종류를 고르세요.")
    if not section:
        raise ValueError("그룹을 고르거나 입력하세요.")
    if not label:
        raise ValueError("이름을 입력하세요.")
    if not prompt:
        raise ValueError("프롬프트를 입력하세요.")
    if etype not in _TYPE_INFO and not db.scalar("SELECT 1 FROM prompt_elements WHERE element_type = ? LIMIT 1", (etype,)):
        raise ValueError("알 수 없는 종류입니다.")
    old = db.row("SELECT element_type, section FROM prompt_elements WHERE id = ?", (eid,)) if eid else None
    if eid and not old:
        raise ValueError("요소를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.")
    same_group = bool(old) and old["element_type"] == etype and old["section"] == section
    if not _TYPE_INFO.get(etype, ("", "", True))[2] and not same_group and not db.scalar(
            "SELECT 1 FROM prompt_elements WHERE element_type = ? AND section = ? LIMIT 1", (etype, section)):
        raise ValueError(f"{element_type_label(etype)}은(는) 빌더의 그룹이 정해져 있어 있는 그룹에만 넣을 수 있습니다.")
    # 가져오기는 (종류, 그룹, 상위 항목, 이름)으로 같은 요소를 가린다: 같은 것을 두 개 만들지 않는다
    if db.scalar("SELECT 1 FROM prompt_elements WHERE element_type = ? AND TRIM(section) = ? "
                 "AND TRIM(COALESCE(parent_label,'')) = ? AND TRIM(label_ko) = ? AND id <> ?",
                 (etype, section, parent, label, eid)):
        raise ValueError(f"‘{section}’ 그룹에 ‘{label}’이(가) 이미 있습니다.")
    if same_group:
        db.execute("UPDATE prompt_elements SET parent_label=?, label_ko=?, prompt=?, is_active=?, updated_at=? WHERE id=?",
                   (parent or None, label, prompt, active, now(), eid))
        return eid
    order = int(db.scalar("SELECT COALESCE(MAX(sort_order), 0) FROM prompt_elements WHERE element_type = ? AND section = ?",
                          (etype, section), 0)) + 1
    if eid:  # 다른 그룹으로 옮기면 그 그룹 맨 뒤로
        db.execute("UPDATE prompt_elements SET element_type=?, section=?, parent_label=?, label_ko=?, prompt=?, "
                   "is_active=?, sort_order=?, updated_at=? WHERE id=?",
                   (etype, section, parent or None, label, prompt, active, order, now(), eid))
        return eid
    cur = db.execute("INSERT INTO prompt_elements (element_type, section, parent_label, label_ko, prompt, sort_order, "
                     "is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                     (etype, section, parent or None, label, prompt, order, active, now(), now()))
    return int(cur.lastrowid)


def delete_elements(ids: list[int]) -> int:
    ids = [int(i) for i in ids if str(i).isdigit()]
    if not ids:
        return 0
    return db.execute(f"DELETE FROM prompt_elements WHERE id IN ({','.join('?' for _ in ids)})", ids).rowcount


# ---------------------------------------------------------------- 스타일

def fetch_styles() -> list[dict]:
    rows = db.rows("""SELECT s.id, s.label_ko,
        (SELECT COUNT(*) FROM prompt_template_items i WHERE i.style_id = s.id) AS total
        FROM prompt_template_styles s""")
    rows.sort(key=lambda r: (natural_key(r["label_ko"]), r["id"]))
    return rows


def selectable_styles() -> list[dict]:
    """사용자가 고르는 스타일 목록 (내부 '기본' 스타일 제외)."""
    return [s for s in fetch_styles() if s["label_ko"].strip() != "기본"]


def basic_style_id() -> int:
    sid = db.scalar("SELECT id FROM prompt_template_styles WHERE label_ko = '기본' ORDER BY id LIMIT 1")
    if sid:
        return int(sid)
    return int(db.execute("INSERT INTO prompt_template_styles (label_ko, created_at, updated_at) VALUES ('기본',?,?)",
                          (now(), now())).lastrowid)


def save_style(style_id: int, label: str) -> int:
    label = str(label or "").strip()
    if not label:
        raise ValueError("스타일 이름을 입력하세요.")
    # 가져오기는 스타일을 이름으로 맞추므로 같은 이름을 두 개 만들지 않는다
    if db.scalar("SELECT 1 FROM prompt_template_styles WHERE TRIM(label_ko) = ? AND id <> ?", (label, style_id)):
        raise ValueError(f"‘{label}’ 스타일이 이미 있습니다.")
    if style_id > 0:
        db.execute("UPDATE prompt_template_styles SET label_ko=?, updated_at=? WHERE id=?", (label, now(), style_id))
        return style_id
    return int(db.execute("INSERT INTO prompt_template_styles (label_ko, created_at, updated_at) VALUES (?,?,?)",
                          (label, now(), now())).lastrowid)


def delete_style(style_id: int) -> None:
    n = db.scalar("SELECT COUNT(*) FROM prompt_template_items WHERE style_id = ?", (style_id,), 0)
    if n:
        raise ValueError(f"이 스타일을 쓰는 템플릿이 {n}개 있습니다. 템플릿의 스타일을 먼저 바꿔 주세요.")
    db.execute("DELETE FROM prompt_template_styles WHERE id = ?", (style_id,))


# ---------------------------------------------------------------- 템플릿 (빌더용)

def fetch_template_rows() -> list[dict]:
    rows = db.rows("""
        SELECT i.id, COALESCE(i.style_id,0) AS style_id, COALESCE(i.label_ko,'') AS label_ko,
               COALESCE(i.user_id,0) AS user_id,
               COALESCE(i.image_url,'') AS image_url, COALESCE(i.lora,'') AS lora, i.created_at,
               COALESCE(a.name,'') AS maker_name, s.label_ko AS style_label
        FROM prompt_template_items i
        LEFT JOIN prompt_template_styles s ON s.id = i.style_id
        LEFT JOIN authors a ON a.id = i.user_id
        ORDER BY i.label_ko, i.id""")
    for r in rows:
        r["image"] = media_url(r["image_url"])
    return rows


def new_badge_day(created_at) -> int:
    """제작 3일 이내면 1~3 (일차), 아니면 0."""
    try:
        ts = datetime.strptime(str(created_at), "%Y-%m-%d %H:%M:%S").timestamp()
    except (TypeError, ValueError):
        return 0
    age = time.time() - ts
    if ts > time.time() + 60 or age > 3 * 86400:
        return 0
    return min(3, int(max(0, age) // 86400) + 1)


def normalize_slots(slot_json) -> list[dict]:
    """slot_json(두 가지 형식)을 빌더가 쓰는 slots 목록으로."""
    decoded = slot_json if isinstance(slot_json, (list, dict)) else None
    if decoded is None:
        try:
            decoded = json.loads(slot_json or "null")
        except ValueError:
            decoded = None
    slots = []
    if isinstance(decoded, list):
        for slot in decoded:
            if not isinstance(slot, dict):
                continue
            options = []
            for o in slot.get("options") or []:
                if isinstance(o, dict):
                    options.append({
                        "id": int(o.get("id") or 0),
                        "label_ko": str(o.get("label_ko") or o.get("name") or ""),
                        "value_prompt": str(o.get("value_prompt") or o.get("prompt") or ""),
                        "is_default": int(o.get("is_default") or 0),
                        "is_active": int(o.get("is_active", 1) if o.get("is_active") is not None else 1),
                        "sort_order": int(o.get("sort_order") or 0),
                    })
            options.sort(key=lambda o: (o["sort_order"], o["label_ko"]))
            slots.append({"id": int(slot.get("id") or 0), "slot_key": str(slot.get("slot_key") or ""),
                          "label_ko": str(slot.get("label_ko") or slot.get("label") or ""),
                          "sort_order": int(slot.get("sort_order") or 0), "is_active": 1, "options": options})
    elif isinstance(decoded, dict) and "variable_settings" in decoded:
        vs = decoded["variable_settings"]
        if isinstance(vs, str):
            try:
                vs = json.loads(vs)
            except ValueError:
                vs = {}
        if isinstance(vs, dict):
            for sort, (name, setting) in enumerate(vs.items()):
                if not isinstance(setting, dict):
                    continue
                default = str(setting.get("default") or "")
                options = []
                for oi, o in enumerate(setting.get("options") or []):
                    if not isinstance(o, dict):
                        continue
                    value = str(o.get("value") or "")
                    options.append({"id": 0, "label_ko": str(o.get("name") or o.get("label_ko") or ""),
                                    "value_prompt": str(o.get("prompt") or o.get("value_prompt") or ""),
                                    "is_default": 1 if value and value == default else 0, "is_active": 1,
                                    "sort_order": oi})
                slots.append({"id": 0, "slot_key": str(name), "label_ko": str(setting.get("label") or name),
                              "sort_order": sort, "is_active": 1, "options": options})
    slots.sort(key=lambda s: (s["sort_order"], s["label_ko"]))
    return slots


def get_template_for_builder(template_id: int) -> dict | None:
    r = db.row("""SELECT i.*, s.label_ko AS style_label_ko FROM prompt_template_items i
                  LEFT JOIN prompt_template_styles s ON s.id = i.style_id WHERE i.id = ?""", (template_id,))
    if not r:
        return None
    negative = (r["negative_prompt"] or "").strip()
    if not negative:
        try:
            sj = json.loads(r["slot_json"] or "{}")
            if isinstance(sj, dict):
                negative = str(sj.get("negative_prompt") or sj.get("negativePrompt") or sj.get("negative") or "").strip()
        except ValueError:
            pass
    return {
        "id": r["id"], "style_id": r["style_id"] or 0, "label_ko": r["label_ko"] or "",
        "style_label_ko": r["style_label_ko"] or "",
        "full_prompt_template": r["base_prompt"] or "", "base_prompt": r["base_prompt"] or "",
        "slot_json": r["slot_json"] or "[]", "negative_prompt": negative,
        "user_image_url": media_url(r["image_url"]), "lora": r["lora"] or "", "lora_prompt": r["lora"] or "",
        "slots": normalize_slots(r["slot_json"]),
    }


# ---------------------------------------------------------------- 의상·배경 프리셋

def outfit_types() -> list[str]:
    types = [clean_label(r["type"]) for r in db.rows(
        "SELECT DISTINCT type FROM prompt_elements_outfit WHERE TRIM(type) <> ''")]
    return sorted({t for t in types if t}, key=ko_key)


def outfit_items(type_: str | None = None) -> list[dict]:
    sql = "SELECT id, type, name, prompt, image_filename FROM prompt_elements_outfit WHERE TRIM(name)<>'' AND TRIM(prompt)<>''"
    params: tuple = ()
    if type_:
        sql += " AND type = ?"
        params = (type_,)
    items = []
    for r in db.rows(sql, params):
        fn = (r["image_filename"] or "").split("/")[-1]
        items.append({"id": r["id"], "type": clean_label(r["type"]), "name": clean_label(r["name"]),
                      "label": clean_label(r["name"]), "prompt": r["prompt"].strip(), "file": fn,
                      "image": f"/media/outfit/{fn}" if fn else ""})
    items.sort(key=lambda i: (ko_key(i["label"]), i["id"]))
    return items


def place_items() -> list[dict]:
    out = []
    for r in fetch_famous_places():
        out.append({"idx": r["idx"], "country": r["country_ko"] or "", "type": r["place_type_ko"] or "",
                    "label": (r["label_ko"] or "").strip() or (r["prompt"] or "").strip(),
                    "prompt": (r["prompt"] or "").strip(), "description": r["description_ko"] or "",
                    "file": f"places_{int(r['idx']):04d}.webp"})
    return out


# ---------------------------------------------------------------- 템플릿 만들기

def strip_markup(s) -> str:
    s = re.sub(r"<[^>]*>", "", str(s or ""))
    return s.replace("<", "").replace(">", "")


def extract_vars(positive: str, negative: str) -> list[str]:
    names = []
    for m in re.finditer(r"\{([a-zA-Z0-9_가-힣\-]+)\}", positive + "\n" + negative):
        if m.group(1) not in names:
            names.append(m.group(1))
    return names


def _norm_inline_label(label: str, fallback: str = "nomame") -> str:
    label = re.sub(r"\s+", "_", label.strip())
    label = re.sub(r"[^a-zA-Z0-9_가-힣\-]", "_", label).strip("_")
    return label or fallback


def _inline_setting(label: str, raw_options: list[str]) -> dict | None:
    opts = []
    for raw in raw_options:
        p = raw.strip()
        if p:
            opts.append({"name": p if len(p) <= 40 else p[:38] + "…", "value": f"opt_{len(opts)}", "prompt": p})
    if len(opts) < 2:
        return None
    return {"type": "select", "label": label, "default": opts[0]["value"], "options": opts}


def convert_inline_selects(positive: str) -> tuple[str, dict]:
    """{pose:A|B|C} → {pose}, {A|B} → {nomame_1} 로 바꾸고 세부항목 설정을 만든다."""
    settings: dict = {}
    used: set = set()
    counter = [1]

    def unique(base: str) -> str:
        base = _norm_inline_label(base)
        name, i = base, 2
        while name in used:
            name = f"{base}_{i}"
            i += 1
        used.add(name)
        return name

    def named(m):
        safe = _norm_inline_label(m.group(1))
        setting = _inline_setting(safe, m.group(2).split("|"))
        if setting is None:
            return m.group(0)
        var = unique(safe)
        settings[var] = setting
        return "{" + var + "}"

    def nameless(m):
        setting = _inline_setting("nomame", m.group(1).split("|"))
        if setting is None:
            return m.group(0)
        var = unique(f"nomame_{counter[0]}")
        counter[0] += 1
        settings[var] = setting
        return "{" + var + "}"

    positive = re.sub(r"\{([^{}:|]+):([^{}]*\|[^{}]*)\}", named, positive)
    positive = re.sub(r"\{([^{}:]*\|[^{}]*)\}", nameless, positive)
    return positive, settings


def _var_settings_from_slot_json(slot_json: str) -> dict:
    try:
        d = json.loads(slot_json or "{}")
    except ValueError:
        return {}
    if isinstance(d, dict):
        vs = d.get("variable_settings")
        if isinstance(vs, str):
            try:
                vs = json.loads(vs)
            except ValueError:
                vs = {}
        return vs if isinstance(vs, dict) else {}
    if isinstance(d, list):  # 슬롯 목록 형식 → variable_settings 형식
        out = {}
        for slot in normalize_slots(d):
            key = slot["slot_key"] or slot["label_ko"]
            opts = [{"name": o["label_ko"], "value": f"opt_{i}", "prompt": o["value_prompt"]}
                    for i, o in enumerate(slot["options"])]
            out[key] = {"type": "select", "label": slot["label_ko"] or key, "default": "opt_0", "options": opts}
        return out
    return {}


def template_list() -> list[dict]:
    rows = db.rows("""SELECT i.id, i.style_id, i.label_ko, i.image_url, i.user_id, i.slot_json,
                             i.created_at, i.updated_at, COALESCE(a.name,'') AS author_name, s.label_ko AS style_label
                      FROM prompt_template_items i
                      LEFT JOIN prompt_template_styles s ON s.id = i.style_id
                      LEFT JOIN authors a ON a.id = i.user_id""")
    out = []
    for r in rows:
        tags = ""
        try:
            sj = json.loads(r["slot_json"] or "{}")
            if isinstance(sj, dict):
                tags = str(sj.get("tags") or "")
        except ValueError:
            pass
        out.append({"id": r["id"], "style_id": r["style_id"] or 0, "title": r["label_ko"] or "",
                    "style_label": r["style_label"] or "", "image": media_url(r["image_url"]),
                    "author": r["author_name"], "tags": tags,
                    "created_at": r["created_at"] or "", "updated_at": r["updated_at"] or "",
                    "new_day": new_badge_day(r["created_at"])})
    return out


def template_for_editor(template_id: int) -> dict | None:
    r = db.row("SELECT * FROM prompt_template_items WHERE id = ?", (template_id,))
    if not r:
        return None
    negative = (r["negative_prompt"] or "").strip()
    sj = {}
    try:
        sj = json.loads(r["slot_json"] or "{}")
    except ValueError:
        pass
    if not negative and isinstance(sj, dict):
        negative = str(sj.get("negative_prompt") or "")
    lora_ids = []
    try:
        for item in json.loads(r["lora"] or "[]") or []:
            if isinstance(item, dict) and item.get("idx"):
                lora_ids.append(int(item["idx"]))
    except (ValueError, TypeError):
        pass
    vs = _var_settings_from_slot_json(r["slot_json"])
    variables = []
    for name in extract_vars(r["base_prompt"] or "", negative):
        s = vs.get(name) or {}
        variables.append({"name": name, "label": str(s.get("label") or name),
                          "options": [{"name": str(o.get("name") or ""), "prompt": str(o.get("prompt") or "")}
                                      for o in (s.get("options") or []) if isinstance(o, dict)]})
    return {"id": r["id"], "title": r["label_ko"] or "", "style_id": r["style_id"] or 0,
            "positive": r["base_prompt"] or "",
            "negative": negative, "image": media_url(r["image_url"]), "lora_ids": lora_ids, "variables": variables,
            "tags": str(sj.get("tags") or "") if isinstance(sj, dict) else "",
            "description": str(sj.get("description") or "") if isinstance(sj, dict) else ""}


def _save_thumbnail(data_url: str, title: str) -> str | None:
    if not data_url:
        return None
    m = re.match(r"^data:image/(webp|png|jpeg);base64,(.+)$", data_url, re.S)
    if not m:
        raise ValueError("썸네일 이미지를 읽을 수 없습니다.")
    blob = base64.b64decode(m.group(2))
    if len(blob) > 8 * 1024 * 1024:
        raise ValueError("썸네일 이미지가 너무 큽니다.")
    ext = {"webp": "webp", "png": "png", "jpeg": "jpg"}[m.group(1)]
    base = re.sub(r"[^\w.\-가-힣]+", "_", title or "template").strip("._-")[:60] or "template"
    name = f"{base}_{datetime.now().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(6)}.{ext}"
    folder = paths.MEDIA_DIR / "template_preview"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / name).write_bytes(blob)
    return f"template_preview/{name}"


def _lora_json(ids: list) -> str:
    ids = sorted({int(i) for i in ids if str(i).isdigit() and int(i) > 0})
    if not ids:
        return ""
    ph = ",".join("?" for _ in ids)
    items = []
    for r in db.rows(f"SELECT * FROM prompt_lora WHERE idx IN ({ph}) ORDER BY title COLLATE NOCASE, idx", ids):
        items.append({"idx": r["idx"], "title": r["title"], "support_type": r["support_type"],
                      "filename": r["filename"], "default_strength": f"{float(r['default_strength'] or 1):.2f}",
                      "trigger_text": r["trigger_text"] or "", "description": r["description"] or "",
                      "url": r["url"] or "", "prompt": lora_prompt_line(r)})
    return json.dumps(items, ensure_ascii=False)


def save_template(data: dict) -> int:
    tid = int(data.get("id") or 0)
    existing = db.row("SELECT * FROM prompt_template_items WHERE id = ?", (tid,)) if tid else None
    if tid and not existing:
        raise ValueError("템플릿을 찾을 수 없습니다.")
    title = strip_markup(data.get("title")).strip()
    positive = strip_markup(data.get("positive")).strip()
    negative = strip_markup(data.get("negative")).strip()
    if not title:
        raise ValueError("제목을 입력하세요.")
    if not positive and not negative:
        raise ValueError("Positive 또는 Negative Prompt를 입력하세요.")
    style_id = int(data.get("style_id") or 0)
    if style_id > 0 and not db.scalar("SELECT 1 FROM prompt_template_styles WHERE id = ?", (style_id,)):
        style_id = 0
    if style_id <= 0:
        style_id = basic_style_id()

    inline: dict = {}
    if re.search(r"\{(?:[^{}:|]+:)?[^{}]*\|[^{}]*\}", positive):
        positive, inline = convert_inline_selects(positive)

    posted = data.get("variables") if isinstance(data.get("variables"), dict) else {}
    var_settings: dict = {}
    for name in extract_vars(positive, negative):
        if name in inline:
            var_settings[name] = inline[name]
            continue
        v = posted.get(name) or {}
        label = _norm_inline_label(strip_markup(v.get("label") or name), name)
        options = []
        for o in v.get("options") or []:
            n = strip_markup(o.get("name")).strip()
            p = strip_markup(o.get("prompt")).strip()
            if not n and not p:
                continue
            options.append({"name": n or str(len(options) + 1), "value": f"opt_{len(options)}", "prompt": p})
        if not options:
            options.append({"name": "1", "value": "opt_0", "prompt": ""})
        var_settings[name] = {"type": "select", "label": label, "default": "opt_0", "options": options}

    thumb = _save_thumbnail(str(data.get("thumbnail") or ""), title)
    lora_ids = list(data.get("lora_ids") or [])
    new_lora = data.get("new_lora") if isinstance(data.get("new_lora"), dict) else None
    if new_lora and str(new_lora.get("filename") or "").strip():
        lora_ids.append(save_lora(new_lora))
    lora = _lora_json(lora_ids)
    old = {}
    if existing:
        try:
            old = json.loads(existing["slot_json"] or "{}")
            old = old if isinstance(old, dict) else {}
        except ValueError:
            old = {}
    slot_json = json.dumps({
        "comfy_settings": old.get("comfy_settings", ""), "description": strip_markup(data.get("description") or old.get("description", "")),
        "negative_prompt": negative, "variable_settings": var_settings,
        "tags": ",".join(t.strip() for t in re.split(r"[,#]+", strip_markup(data.get("tags") or old.get("tags", ""))) if t.strip()),
        "rebuild_count": int(old.get("rebuild_count") or 0)}, ensure_ascii=False)

    if existing:
        sets = {"style_id": style_id, "label_ko": title, "base_prompt": positive, "negative_prompt": negative,
                "slot_json": slot_json, "lora": lora, "updated_at": now()}
        if thumb:
            sets["image_url"] = thumb
        if data.get("remove_thumbnail") and not thumb:
            sets["image_url"] = ""
        db.execute("UPDATE prompt_template_items SET " + ", ".join(f"{k} = ?" for k in sets) + " WHERE id = ?",
                   list(sets.values()) + [tid])
        return tid
    cur = db.execute(
        "INSERT INTO prompt_template_items (style_id, user_id, label_ko, image_url, base_prompt, negative_prompt, "
        "slot_json, lora, is_user_template, is_public, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,1,1,?,?)",
        (style_id, 1, title, thumb or "", positive, negative, slot_json, lora, now(), now()))
    return int(cur.lastrowid)


def duplicate_template(tid: int) -> int:
    r = db.row("SELECT * FROM prompt_template_items WHERE id = ?", (tid,))
    if not r:
        raise ValueError("템플릿을 찾을 수 없습니다.")
    cur = db.execute(
        "INSERT INTO prompt_template_items (style_id, user_id, label_ko, image_url, base_prompt, negative_prompt, "
        "slot_json, lora, is_user_template, is_public, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,1,1,?,?)",
        (r["style_id"], r["user_id"], (r["label_ko"] or "") + " 사본", r["image_url"], r["base_prompt"],
         r["negative_prompt"], r["slot_json"], r["lora"], now(), now()))
    return int(cur.lastrowid)


def set_style(tid: int, style_id: int) -> dict:
    if not db.scalar("SELECT 1 FROM prompt_template_items WHERE id = ?", (tid,)):
        raise ValueError("템플릿을 찾을 수 없습니다.")
    if style_id > 0 and not db.scalar("SELECT 1 FROM prompt_template_styles WHERE id = ?", (style_id,)):
        raise ValueError("선택할 수 없는 스타일입니다.")
    sid = style_id if style_id > 0 else basic_style_id()  # 스타일 없음 → '기본'
    db.execute("UPDATE prompt_template_items SET style_id = ?, updated_at = ? WHERE id = ?", (sid, now(), tid))
    label = db.scalar("SELECT label_ko FROM prompt_template_styles WHERE id = ?", (sid,), "")
    return {"style_id": sid, "label": label or ""}


def delete_template(tid: int) -> None:
    db.execute("DELETE FROM prompt_template_items WHERE id = ?", (tid,))
