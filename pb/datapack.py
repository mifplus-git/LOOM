"""데이터 묶음: 템플릿(스타일 포함) · 프롬프트 요소 · 의상 프리셋 · 유명 배경을 따로 내보내고·가져오고·비운다.

앱(GitHub 소스)에는 데이터가 들어 있지 않다. 네 종류 모두 묶음 파일(zip)로 따로 나눠 주고 데이터 메뉴에서 가져온다.
묶음은 zip 하나: pb-data.json(행 데이터) + media/<폴더>/<파일>(썸네일·미리보기 이미지).
같은 구조를 풀어 둔 폴더도 가져올 수 있다.

가져오기 규칙
- 템플릿: 스타일은 이름이 같으면 이미 있는 스타일을 쓴다. 제목이 이미 있으면 '제목 (1)', '제목 (2)'…로 넣는다.
  내보내기 · 가져오기 모두 스타일을 골라 그 스타일의 템플릿만 옮길 수 있다.
- 프롬프트 요소 · 의상 · 유명 배경: 같은 항목이 이미 있으면 이미 있는 것을 두고 건너뛴다.
  프롬프트 요소는 종류(인물 · 메이크업 · 의상 …, 배경 옵션)를 골라 그 종류만 옮길 수 있다.
- 원래 id가 비어 있으면 그 id를 그대로 쓴다 (비운 뒤 다시 가져와도 생성 기록의 '빌더에서 열기'가 맞는다).
비우기는 DB 행을 지우고 이미지 폴더는 휴지통으로 보낸다 (휴지통에서 되살릴 수 있다).
"""
from __future__ import annotations

import json
import re
import shutil
import zipfile
from datetime import datetime
from pathlib import Path

from . import db, paths, repo

FORMAT = "prompt-builder-data"  # 이름을 바꾸기 전부터 쓰던 형식 이름. 이미 나눠 준 묶음과 맞추려고 그대로 둔다
FORMAT_VERSION = 1
MANIFEST = "pb-data.json"

KINDS = {
    "templates": {"label": "템플릿", "media": ("template_preview",)},
    "elements": {"label": "프롬프트 요소", "media": ()},
    "outfits": {"label": "의상 프리셋", "media": ("outfit", "outfit_krea")},
    "places": {"label": "유명 배경", "media": ("places", "places_krea")},
}


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def check_kind(kind: str) -> dict:
    if kind not in KINDS:
        raise ValueError("알 수 없는 데이터 종류입니다.")
    return KINDS[kind]


def default_name(kind: str, styles: list[int] | None = None, types: list[str] | None = None) -> str:
    """스타일 · 종류를 골라 내보내면 이름에 넣는다: loom-templates-코스튬(미디어)-외1-20261016-1200.zip"""
    labels: list[str] = []
    if kind == "templates" and styles:
        labels = [s["label"] for s in template_styles() if s["id"] in set(styles)]
    elif kind == "elements" and types:
        labels = [g["label"] for g in element_groups() if g["key"] in set(types)]
    part = ""
    if labels:
        name = re.sub(r"^\d+\s*[.)]\s*", "", labels[0])           # 앞의 순서 번호 (예: '50. ')
        name = re.sub(r"[\\/:*?\"<>|,\s]+", "_", name).strip("_.") or "part"  # 파일 이름에 못 쓰는 글자
        part = f"-{name}" + (f"-외{len(labels) - 1}" if len(labels) > 1 else "")
    return f"loom-{kind}{part}-{datetime.now().strftime('%Y%m%d-%H%M')}.zip"


def template_styles() -> list[dict]:
    """템플릿 스타일과 스타일마다 템플릿 수 (스타일 관리와 같은 순서)."""
    return [{"id": s["id"], "label": s["label_ko"], "count": s["total"]} for s in repo.fetch_styles()]


PLACE_SLOTS = "place_slots"  # 프롬프트 요소 묶음에 함께 담는 배경 슬롯 옵션 (종류처럼 고른다)


def element_groups() -> list[dict]:
    """프롬프트 요소를 종류별로 나눈 것과 종류마다 개수 (+ 배경 옵션)."""
    out = [{"key": t["key"], "label": t["label"], "count": t["count"]} for t in repo.element_types() if t["count"]]
    n = db.scalar("SELECT COUNT(*) FROM prompt_famous_place_slot_options", (), 0)
    if n:
        out.append({"key": PLACE_SLOTS, "label": "배경 옵션", "count": n})
    return out


# ---------------------------------------------------------------- 현황

def _count(kind: str) -> tuple[int, int]:
    """(행 수, 딸린 항목 수: 템플릿은 스타일, 프롬프트 요소는 배경 슬롯 옵션)."""
    if kind == "templates":
        return (db.scalar("SELECT COUNT(*) FROM prompt_template_items", (), 0),
                db.scalar("SELECT COUNT(*) FROM prompt_template_styles", (), 0))
    if kind == "elements":
        return (db.scalar("SELECT COUNT(*) FROM prompt_elements", (), 0),
                db.scalar("SELECT COUNT(*) FROM prompt_famous_place_slot_options", (), 0))
    if kind == "outfits":
        return db.scalar("SELECT COUNT(*) FROM prompt_elements_outfit", (), 0), 0
    return db.scalar("SELECT COUNT(*) FROM prompt_famous_places", (), 0), 0


def _folder_files(folder: str) -> list[Path]:
    d = paths.MEDIA_DIR / folder
    if not d.is_dir():
        return []
    return [f for f in d.iterdir() if f.is_file() and not f.name.startswith(".")]


def summary() -> list[dict]:
    out = []
    for kind, k in KINDS.items():
        count, extra = _count(kind)
        files = [f for folder in k["media"] for f in _folder_files(folder)]
        out.append({"kind": kind, "label": k["label"], "count": count, "extra": extra,
                    "images": len(files), "size": sum(f.stat().st_size for f in files)})
        if kind == "templates":
            out[-1]["styles"] = template_styles()
        if kind == "elements":
            out[-1]["types"] = element_groups()
    return out


# ---------------------------------------------------------------- 내보내기

def _template_image_rel(image_url: str) -> str:
    """DB의 image_url → media 아래 상대경로 ('template_preview/a.webp'). 외부 주소면 ''."""
    u = str(image_url or "").strip()
    if not u or u.startswith(("http://", "https://")):
        return ""
    u = re.sub(r"^(?:\./)?_upload/", "", u).lstrip("/")
    u = re.sub(r"^media/", "", u)
    return u if "/" in u else "template_preview/" + u


def _collect(kind: str, styles: list[int] | None = None,
             types: list[str] | None = None) -> tuple[dict, list[tuple[str, Path]], int]:
    """(묶음에 들어갈 데이터, [(zip 안 경로, 파일)], 행 수). styles: 템플릿을 이 스타일(id)의 것만 담는다 (None = 전부).
    types: 프롬프트 요소를 이 종류(element_type, 배경 옵션은 PLACE_SLOTS)의 것만 담는다 (None = 전부)."""
    files: list[tuple[str, Path]] = []

    def add_file(folder: str, name: str) -> bool:
        src = paths.MEDIA_DIR / folder / name
        if name and src.is_file():
            files.append((f"media/{folder}/{name}", src))
            return True
        return False

    if kind == "templates":
        want = None if styles is None else {int(i) for i in styles}
        style_rows = [{"id": r["id"], "label": r["label_ko"]} for r in db.rows("SELECT id, label_ko FROM prompt_template_styles ORDER BY id")
                      if want is None or r["id"] in want]
        items = []
        for r in db.rows("""SELECT i.*, s.label_ko AS style_label, a.name AS author_name
                            FROM prompt_template_items i
                            LEFT JOIN prompt_template_styles s ON s.id = i.style_id
                            LEFT JOIN authors a ON a.id = i.user_id ORDER BY i.id"""):
            if want is not None and r["style_id"] not in want:
                continue
            rel = _template_image_rel(r["image_url"])
            image = ""
            if rel:
                folder, _, name = rel.partition("/")
                image = rel if folder == "template_preview" and "/" not in name and add_file(folder, name) else ""
            elif str(r["image_url"] or "").startswith(("http://", "https://")):
                image = r["image_url"]
            items.append({"id": r["id"], "title": r["label_ko"] or "", "style": r["style_label"] or "",
                          "author": r["author_name"] or "", "image": image, "base_prompt": r["base_prompt"] or "",
                          "negative_prompt": r["negative_prompt"] or "", "slot_json": r["slot_json"] or "{}",
                          "lora": r["lora"] or "", "created_at": r["created_at"], "updated_at": r["updated_at"]})
        return {"styles": style_rows, "templates": items}, files, len(items)

    if kind == "elements":
        want = None if types is None else set(types)
        elements = [e for e in db.rows("SELECT id, element_type, section, parent_label, label_ko, prompt, sort_order, "
                                       "is_active, source_id, created_at, updated_at FROM prompt_elements ORDER BY id")
                    if want is None or e["element_type"] in want]
        slots = []
        for s in db.rows("SELECT * FROM prompt_famous_place_slots ORDER BY sort_order, id"):
            if want is not None and PLACE_SLOTS not in want:
                break
            s["options"] = db.rows("SELECT id, label_ko, value_prompt, is_default, sort_order, is_active, created_at, "
                                   "updated_at FROM prompt_famous_place_slot_options WHERE slot_id = ? "
                                   "ORDER BY sort_order, id", (s["id"],))
            slots.append(s)
        n = len(elements) + (sum(len(s["options"]) for s in slots) if not elements else 0)  # 배경 옵션만 고른 경우
        return {"elements": elements, "place_slots": slots}, files, n

    if kind == "outfits":
        items = db.rows("SELECT * FROM prompt_elements_outfit ORDER BY id")
        for r in items:
            name = Path(str(r["image_filename"] or "")).name
            r["image_filename"] = name
            for folder in KINDS["outfits"]["media"]:
                add_file(folder, name)
        return {"outfits": items}, files, len(items)

    items = db.rows("SELECT * FROM prompt_famous_places ORDER BY idx")
    for r in items:
        for folder in KINDS["places"]["media"]:
            add_file(folder, place_file(r["idx"]))
    return {"places": items}, files, len(items)


def place_file(idx) -> str:
    return f"places_{int(idx):04d}.webp"


def export(kind: str, dest: Path, styles: list[int] | None = None, types: list[str] | None = None) -> dict:
    """styles: 템플릿만 — 고른 스타일(id)의 템플릿만 내보낸다 (None = 전부).
    types: 프롬프트 요소만 — 고른 종류만 내보낸다 (None = 전부)."""
    k = check_kind(kind)
    dest = Path(dest).expanduser()
    if dest.suffix.lower() != ".zip":
        dest = dest.with_name(dest.name + ".zip")
    styles = styles if kind == "templates" else None
    types = types if kind == "elements" else None
    payload, files, count = _collect(kind, styles, types)
    if not count and styles is not None:
        raise ValueError("고른 스타일에 템플릿이 없습니다.")
    if not count and types is not None:
        raise ValueError("고른 종류에 요소가 없습니다.")
    manifest = {"format": FORMAT, "version": FORMAT_VERSION, "kind": kind, "label": k["label"],
                "app_version": paths.APP_VERSION, "exported_at": now(), "count": count, **payload}
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(MANIFEST, json.dumps(manifest, ensure_ascii=False, indent=1))
            for arc, src in files:
                z.write(src, arc, compress_type=zipfile.ZIP_STORED)  # webp·png는 이미 압축돼 있다
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)
    return {"path": str(dest), "name": dest.name, "count": count, "images": len(files), "size": dest.stat().st_size}


# ---------------------------------------------------------------- 가져오기

def read_manifest(z: zipfile.ZipFile) -> dict:
    try:
        m = json.loads(z.read(MANIFEST).decode("utf-8"))
    except KeyError:
        raise ValueError(f"{paths.APP_NAME} 데이터 파일이 아닙니다 (pb-data.json 없음).")
    except ValueError:
        raise ValueError("데이터 파일을 읽을 수 없습니다.")
    if not isinstance(m, dict) or m.get("format") != FORMAT:
        raise ValueError(f"{paths.APP_NAME} 데이터 파일이 아닙니다.")
    if int(m.get("version") or 0) > FORMAT_VERSION:
        raise ValueError("더 새로운 버전의 앱에서 만든 파일입니다. 앱을 업데이트한 뒤 가져오세요.")
    return m


class _Files:
    """zip 안 이미지를 media 폴더로 옮긴다. 실패하면 rollback()으로 이번에 쓴 파일을 지운다."""

    def __init__(self, z: zipfile.ZipFile):
        self.z = z
        self.names = set(z.namelist())
        self.written: list[Path] = []
        self.count = 0

    def member(self, folder: str, name: str) -> str | None:
        arc = f"media/{folder}/{name}"
        return arc if name and "/" not in name and name not in (".", "..") and arc in self.names else None

    def _same(self, target: Path, arc: str) -> bool:
        return target.is_file() and target.stat().st_size == self.z.getinfo(arc).file_size \
            and target.read_bytes() == self.z.read(arc)

    def _write(self, target: Path, arc: str) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        with self.z.open(arc) as src, open(target, "wb") as dst:
            shutil.copyfileobj(src, dst)
        self.written.append(target)
        self.count += 1

    def place(self, name: str, folders: tuple[str, ...]) -> str:
        """같은 파일 이름을 여러 폴더(예: outfit · outfit_krea)에 함께 넣는다.
        그 이름에 다른 파일이 있으면 name_1, name_2…로 바꾸고, 내용이 같으면 그대로 쓴다. 반환: 쓴 이름 ('' = 이미지 없음)."""
        name = Path(str(name or "")).name
        members = {f: self.member(f, name) for f in folders}
        members = {f: a for f, a in members.items() if a}
        if not members:
            return ""
        stem, ext = Path(name).stem, Path(name).suffix
        cand, i = name, 1
        while True:
            # 비어 있거나 같은 파일이면 쓸 수 있다. 묶음에 없는 폴더도 그 이름이 비어 있어야 한다
            # (모델을 바꿨을 때 다른 의상의 이미지가 보이지 않도록)
            free = True
            for f in folders:
                target = paths.MEDIA_DIR / f / cand
                if target.exists() and not (f in members and self._same(target, members[f])):
                    free = False
                    break
            if free:
                break
            cand, i = f"{stem}_{i}{ext}", i + 1
        for f, arc in members.items():
            target = paths.MEDIA_DIR / f / cand
            if not self._same(target, arc):
                self._write(target, arc)
        return cand

    def put(self, folder: str, src_name: str, target_name: str) -> bool:
        """정해진 이름으로 덮어쓴다 (유명 배경: 파일 이름이 idx로 정해진다)."""
        arc = self.member(folder, Path(str(src_name or "")).name)
        if not arc:
            return False
        target = paths.MEDIA_DIR / folder / target_name
        if not self._same(target, arc):
            self._write(target, arc)
        return True

    def rollback(self) -> None:
        for p in self.written:
            p.unlink(missing_ok=True)


def _int(v, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _s(v) -> str:
    return "" if v is None else str(v)


def _ids(conn, table: str, col: str = "id") -> set[int]:
    return {r[0] for r in conn.execute(f"SELECT {col} FROM {table}")}


def _keep_id(raw, taken: set[int]):
    """원래 id가 비어 있으면 그대로, 아니면 None (새 id)."""
    i = _int(raw)
    if i > 0 and i not in taken:
        taken.add(i)
        return i
    return None


def _insert(conn, table: str, row: dict, taken: set[int], col: str = "id") -> int:
    rid = _keep_id(row.pop(col, None), taken)
    if rid is not None:
        row = {col: rid, **row}
    cur = conn.execute(f"INSERT INTO {table} ({', '.join(row)}) VALUES ({', '.join('?' for _ in row)})",
                       list(row.values()))
    taken.add(int(cur.lastrowid))
    return int(cur.lastrowid)


def _rows(m: dict, key: str) -> list[dict]:
    v = m.get(key)
    return [r for r in v if isinstance(r, dict)] if isinstance(v, list) else []


def _style_label(label) -> str:
    """가져올 때 스타일 이름 (비어 있으면 '기본')."""
    return _s(label).strip() or "기본"


def _import_templates(conn, m: dict, files: _Files, only: set[str] | None = None) -> dict:
    """only: 이 스타일(이름)의 템플릿만 가져온다 (None = 전부)."""
    styles: dict[str, int] = {}
    for r in conn.execute("SELECT id, label_ko FROM prompt_template_styles ORDER BY id"):
        styles.setdefault(str(r[1] or "").strip(), r[0])
    style_ids = _ids(conn, "prompt_template_styles")
    new_styles = 0

    def style_id(label: str, orig_id=None) -> int:
        nonlocal new_styles
        label = _style_label(label)
        if label not in styles:
            styles[label] = _insert(conn, "prompt_template_styles",
                                    {"id": orig_id, "label_ko": label, "created_at": now(), "updated_at": now()}, style_ids)
            new_styles += 1
        return styles[label]

    for st in m.get("styles") or []:
        if isinstance(st, dict) and _s(st.get("label")).strip() and (only is None or _style_label(st["label"]) in only):
            style_id(_s(st["label"]), st.get("id"))

    authors = {}
    for r in conn.execute("SELECT id, name FROM authors ORDER BY id"):
        authors.setdefault(str(r[1] or "").strip(), r[0])
    author_ids = _ids(conn, "authors")

    def author_id(name: str):
        name = name.strip()
        if not name:
            return None
        if name not in authors:
            authors[name] = _insert(conn, "authors", {"name": name}, author_ids)
        return authors[name]

    loras = {str(r[1] or "").strip().lower(): r[0] for r in conn.execute("SELECT idx, filename FROM prompt_lora")}
    lora_ids = _ids(conn, "prompt_lora", "idx")

    def relink_lora(raw: str) -> str:
        """템플릿에 딸린 LoRA를 이 DB의 LoRA 목록(파일명 기준)에 다시 잇는다. 없으면 목록에 추가."""
        try:
            items = json.loads(raw or "[]")
        except ValueError:
            return ""
        if not isinstance(items, list):
            return ""
        out = []
        for it in items:
            if not isinstance(it, dict) or not str(it.get("filename") or "").strip():
                continue
            fn = str(it["filename"]).strip()
            if fn.lower() not in loras:
                try:
                    strength = float(it.get("default_strength") or 1)
                except (TypeError, ValueError):
                    strength = 1.0
                loras[fn.lower()] = _insert(conn, "prompt_lora", {
                    "title": _s(it.get("title")) or fn, "support_type": _s(it.get("support_type")), "filename": fn,
                    "default_strength": strength, "trigger_text": _s(it.get("trigger_text")),
                    "description": _s(it.get("description")), "url": _s(it.get("url")), "is_active": 1,
                    "created_at": now()}, lora_ids, "idx")
            out.append({**it, "idx": loras[fn.lower()]})
        return json.dumps(out, ensure_ascii=False) if out else ""

    existing_titles = {str(r[0] or "") for r in conn.execute("SELECT label_ko FROM prompt_template_items")}
    used = set(existing_titles)
    tpl_ids = _ids(conn, "prompt_template_items")
    added = renamed = 0
    for t in _rows(m, "templates"):
        if only is not None and _style_label(t.get("style")) not in only:
            continue
        title = _s(t.get("title")).strip() or "이름 없는 템플릿"
        if title in existing_titles:
            n = 1
            while f"{title} ({n})" in used:
                n += 1
            title = f"{title} ({n})"
            renamed += 1
        used.add(title)
        image = _s(t.get("image"))
        if not image.startswith(("http://", "https://")):
            folder, _, name = image.partition("/")
            placed = files.place(name, ("template_preview",)) if folder == "template_preview" else ""
            image = f"template_preview/{placed}" if placed else ""
        _insert(conn, "prompt_template_items", {
            "id": t.get("id"), "style_id": style_id(_s(t.get("style"))), "user_id": author_id(_s(t.get("author"))),
            "label_ko": title, "image_url": image, "base_prompt": _s(t.get("base_prompt")),
            "negative_prompt": _s(t.get("negative_prompt")), "slot_json": _s(t.get("slot_json")) or "{}",
            "lora": relink_lora(_s(t.get("lora"))), "is_user_template": 1, "is_public": 1,
            "created_at": _s(t.get("created_at")) or now(), "updated_at": _s(t.get("updated_at")) or now()}, tpl_ids)
        added += 1
    return {"added": added, "renamed": renamed, "skipped": 0, "styles_added": new_styles}


def _import_elements(conn, m: dict, files: _Files, only: set[str] | None = None) -> dict:
    """only: 이 종류(element_type, 배경 옵션은 PLACE_SLOTS)만 가져온다 (None = 전부)."""
    def key(r) -> tuple:
        return (_s(r["element_type"]).strip(), _s(r["section"]).strip(), _s(r["parent_label"]).strip(),
                _s(r["label_ko"]).strip())

    existing = {key(r) for r in conn.execute("SELECT element_type, section, parent_label, label_ko FROM prompt_elements")}
    ids = _ids(conn, "prompt_elements")
    added = skipped = 0
    for e in _rows(m, "elements"):
        e = {k: e.get(k) for k in ("id", "element_type", "section", "parent_label", "label_ko", "prompt",
                                   "sort_order", "is_active", "source_id", "created_at", "updated_at")}
        if not _s(e["element_type"]).strip() or (only is not None and _s(e["element_type"]).strip() not in only):
            continue
        if key(e) in existing:
            skipped += 1
            continue
        e.update(section=_s(e["section"]), label_ko=_s(e["label_ko"]), prompt=_s(e["prompt"]),
                 sort_order=_int(e["sort_order"]), is_active=_int(e["is_active"], 1))
        _insert(conn, "prompt_elements", e, ids)
        added += 1

    slots = {_s(r[1]).strip(): r[0] for r in conn.execute("SELECT id, slot_key FROM prompt_famous_place_slots")}
    old_opts: dict[int, set] = {}
    for r in conn.execute("SELECT slot_id, label_ko FROM prompt_famous_place_slot_options"):
        old_opts.setdefault(r[0], set()).add(_s(r[1]).strip())
    slot_ids = _ids(conn, "prompt_famous_place_slots")
    opt_ids = _ids(conn, "prompt_famous_place_slot_options")
    opts_added = 0
    for s in (_rows(m, "place_slots") if only is None or PLACE_SLOTS in only else []):
        sk = _s(s.get("slot_key")).strip()
        if not sk:
            continue
        if sk not in slots:
            slots[sk] = _insert(conn, "prompt_famous_place_slots", {
                "id": s.get("id"), "slot_key": sk, "label_ko": _s(s.get("label_ko")),
                "sort_order": _int(s.get("sort_order")), "is_active": _int(s.get("is_active"), 1),
                "created_at": s.get("created_at"), "updated_at": s.get("updated_at")}, slot_ids)
        sid = slots[sk]
        for o in s.get("options") or []:
            if not isinstance(o, dict) or _s(o.get("label_ko")).strip() in old_opts.get(sid, set()):
                continue
            _insert(conn, "prompt_famous_place_slot_options", {
                "id": o.get("id"), "slot_id": sid, "label_ko": _s(o.get("label_ko")),
                "value_prompt": _s(o.get("value_prompt")), "is_default": _int(o.get("is_default")),
                "sort_order": _int(o.get("sort_order")), "is_active": _int(o.get("is_active"), 1),
                "created_at": o.get("created_at"), "updated_at": o.get("updated_at")}, opt_ids)
            opts_added += 1
    return {"added": added, "skipped": skipped, "renamed": 0, "options_added": opts_added}


def _import_outfits(conn, m: dict, files: _Files) -> dict:
    existing = {(_s(r[0]).strip(), _s(r[1]).strip()) for r in conn.execute("SELECT type, name FROM prompt_elements_outfit")}
    ids = _ids(conn, "prompt_elements_outfit")
    added = skipped = 0
    for o in _rows(m, "outfits"):
        if (_s(o.get("type")).strip(), _s(o.get("name")).strip()) in existing:
            skipped += 1
            continue
        _insert(conn, "prompt_elements_outfit", {
            "id": o.get("id"), "type": _s(o.get("type")), "name": _s(o.get("name")), "prompt": _s(o.get("prompt")),
            "image_filename": files.place(_s(o.get("image_filename")), KINDS["outfits"]["media"]),
            "created_at": o.get("created_at"), "updated_at": o.get("updated_at")}, ids)
        added += 1
    return {"added": added, "skipped": skipped, "renamed": 0}


def _import_places(conn, m: dict, files: _Files) -> dict:
    def key(country, ptype, label) -> tuple:
        return (_s(country).strip(), _s(ptype).strip(), _s(label).strip())

    existing = {key(*r) for r in conn.execute("SELECT country_ko, place_type_ko, label_ko FROM prompt_famous_places")}
    ids = _ids(conn, "prompt_famous_places", "idx")
    added = skipped = 0
    for p in _rows(m, "places"):
        if key(p.get("country_ko"), p.get("place_type_ko"), p.get("label_ko")) in existing:
            skipped += 1
            continue
        idx = _insert(conn, "prompt_famous_places", {
            "idx": p.get("idx"), "country_ko": _s(p.get("country_ko")), "place_type_ko": _s(p.get("place_type_ko")),
            "label_ko": _s(p.get("label_ko")), "description_ko": p.get("description_ko"), "prompt": _s(p.get("prompt")),
            "template_key": p.get("template_key"), "is_active": _int(p.get("is_active"), 1),
            "created_at": p.get("created_at"), "updated_at": p.get("updated_at")}, ids, "idx")
        # 미리보기 파일 이름은 idx로 정해진다 (places_0001.webp)
        for folder in KINDS["places"]["media"]:
            if not files.put(folder, place_file(_int(p.get("idx"))), place_file(idx)):
                (paths.MEDIA_DIR / folder / place_file(idx)).unlink(missing_ok=True)  # 예전 파일이 남아 있지 않도록
        added += 1
    return {"added": added, "skipped": skipped, "renamed": 0}


IMPORTERS = {"templates": _import_templates, "elements": _import_elements,
             "outfits": _import_outfits, "places": _import_places}


class _FolderPack:
    """zip을 풀어 둔 폴더를 ZipFile처럼 읽는다 (가져오기에 필요한 것만)."""

    def __init__(self, root: Path):
        self.root = root.resolve()
        self._names = {p.relative_to(self.root).as_posix(): p for p in self.root.rglob("*")
                       if p.is_file() and not p.name.startswith(".")}

    def namelist(self) -> list[str]:
        return list(self._names)

    def getinfo(self, name: str):
        return _Size(self._names[name].stat().st_size)

    def read(self, name: str) -> bytes:
        if name not in self._names:
            raise KeyError(name)
        return self._names[name].read_bytes()

    def open(self, name: str):
        return open(self._names[name], "rb")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _Size:
    def __init__(self, size: int):
        self.file_size = size


def _open_pack(src: Path):
    src = Path(src).expanduser()
    if src.is_dir() and (src / MANIFEST).is_file():
        return _FolderPack(src)
    if src.is_file():
        try:
            return zipfile.ZipFile(src)
        except zipfile.BadZipFile:
            raise ValueError(f"{paths.APP_NAME} 데이터 파일(zip)이 아닙니다.")
    raise ValueError("파일을 찾을 수 없습니다.")


def _check_pack_kind(m: dict, kind: str, k: dict) -> None:
    if m.get("kind") != kind:
        other = KINDS.get(str(m.get("kind")), {}).get("label", "다른 종류의")
        raise ValueError(f"‘{other}’ 데이터 파일입니다. ‘{other}’ 줄의 가져오기로 넣어 주세요."
                         if other != "다른 종류의" else f"‘{k['label']}’ 데이터 파일이 아닙니다.")


def inspect_pack(kind: str, src: Path) -> dict:
    """가져오기 전에 묶음 안을 본다. 템플릿은 스타일마다 템플릿 수 (가져올 스타일을 고르게)."""
    k = check_kind(kind)
    with _open_pack(src) as z:
        m = read_manifest(z)
    _check_pack_kind(m, kind, k)
    out = {"path": str(Path(src).expanduser()), "name": Path(src).name, "label": k["label"],
           "count": int(m.get("count") or 0)}
    if kind == "templates":
        counts: dict[str, int] = {}
        for t in _rows(m, "templates"):
            label = _style_label(t.get("style"))
            counts[label] = counts.get(label, 0) + 1
        have = {_style_label(r["label_ko"]) for r in db.rows("SELECT label_ko FROM prompt_template_styles")}
        out["styles"] = [{"label": label, "count": n, "exists": label in have}
                         for label, n in sorted(counts.items(), key=lambda x: repo.natural_key(x[0]))]
    if kind == "elements":
        out["types"] = _pack_element_groups(m)
    return out


def _pack_element_groups(m: dict) -> list[dict]:
    """묶음 안의 프롬프트 요소 종류와 개수 (앱이 아는 종류 순서, 모르는 종류는 뒤에)."""
    counts: dict[str, int] = {}
    for e in _rows(m, "elements"):
        t = _s(e.get("element_type")).strip()
        if t:
            counts[t] = counts.get(t, 0) + 1
    order = [k for k, *_ in repo.ELEMENT_TYPES]
    out = [{"key": t, "label": repo.element_type_label(t), "count": n}
           for t, n in sorted(counts.items(), key=lambda x: (order.index(x[0]) if x[0] in order else len(order), x[0]))]
    n = sum(len(s.get("options") or []) for s in _rows(m, "place_slots"))
    if n:
        out.append({"key": PLACE_SLOTS, "label": "배경 옵션", "count": n})
    return out


def import_pack(kind: str, src: Path, before=None, styles: list[str] | None = None,
                types: list[str] | None = None) -> dict:
    """src: 묶음 zip 또는 그것을 풀어 둔 폴더. before: 파일을 확인한 뒤 DB를 바꾸기 직전에 부른다 (자동 백업).
    styles: 템플릿만 — 이 스타일(이름)의 템플릿만 가져온다 (None = 전부).
    types: 프롬프트 요소만 — 이 종류만 가져온다 (None = 전부)."""
    k = check_kind(kind)
    only = {_style_label(s) for s in styles} if kind == "templates" and styles is not None else None
    if only is not None and not only:
        raise ValueError("가져올 스타일을 고르세요.")
    only_types = {str(t) for t in types} if kind == "elements" and types is not None else None
    if only_types is not None and not only_types:
        raise ValueError("가져올 종류를 고르세요.")
    with _open_pack(src) as z:
        m = read_manifest(z)
        _check_pack_kind(m, kind, k)
        backup = before() if before else None
        files = _Files(z)
        try:
            with db.transaction() as conn:
                if only is not None:
                    res = _import_templates(conn, m, files, only)
                elif only_types is not None:
                    res = _import_elements(conn, m, files, only_types)
                else:
                    res = IMPORTERS[kind](conn, m, files)
        except Exception:
            files.rollback()
            raise
    total = int(m.get("count") or 0)
    if only is not None:
        total = sum(1 for t in _rows(m, "templates") if _style_label(t.get("style")) in only)
    if only_types is not None:
        total = sum(g["count"] for g in _pack_element_groups(m) if g["key"] in only_types and g["key"] != PLACE_SLOTS)
    return {**res, "images": files.count, "label": k["label"], "total": total,
            "backup": backup.name if backup else ""}


# ---------------------------------------------------------------- 비우기

def _move_to_trash(p: Path) -> bool:
    try:
        from PySide6.QtCore import QFile
        r = QFile.moveToTrash(str(p))
        if (r[0] if isinstance(r, tuple) else bool(r)) and not p.exists():
            return True
    except Exception:  # noqa: BLE001  Qt가 없으면 아래 방법으로 (macOS 휴지통 폴더)
        pass
    trash = paths.HOME / ".Trash"
    try:
        if trash.is_dir() and trash.stat().st_dev == p.stat().st_dev:
            target = trash / p.name
            if not target.exists():
                p.rename(target)
                return True
    except OSError:
        pass
    return False


def _trash_folder(folder: str, label: str) -> dict:
    """이미지 폴더를 통째로 휴지통으로 보내고 빈 폴더를 새로 만든다.
    휴지통으로 못 보내면 backups 폴더로 옮긴다 (지우지는 않는다)."""
    d = paths.MEDIA_DIR / folder
    files = _folder_files(folder)
    if not files:
        d.mkdir(parents=True, exist_ok=True)
        return {"folder": folder, "files": 0, "where": ""}
    named = d.with_name(f"{paths.APP_NAME} {label} {folder} {datetime.now().strftime('%Y-%m-%d %H.%M.%S')}")
    d.rename(named)
    d.mkdir(parents=True, exist_ok=True)
    if _move_to_trash(named):
        return {"folder": folder, "files": len(files), "where": "trash"}
    paths.BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    shutil.move(str(named), str(paths.BACKUP_DIR / named.name))
    return {"folder": folder, "files": len(files), "where": "backups"}


CLEAR_TABLES = {
    "templates": ("prompt_template_items", "prompt_template_styles"),
    "elements": ("prompt_elements", "prompt_famous_place_slot_options", "prompt_famous_place_slots"),
    "outfits": ("prompt_elements_outfit",),
    "places": ("prompt_famous_places",),
}


def clear(kind: str) -> dict:
    k = check_kind(kind)
    count, _ = _count(kind)
    with db.transaction() as conn:
        for table in CLEAR_TABLES[kind]:
            conn.execute(f"DELETE FROM {table}")
    folders = [_trash_folder(f, k["label"]) for f in k["media"]]
    return {"removed": count, "images": sum(f["files"] for f in folders),
            "where": next((f["where"] for f in folders if f["where"]), ""), "label": k["label"]}
