"""로컬 HTTP 서버 (127.0.0.1 전용, 표준 라이브러리만 사용)."""
from __future__ import annotations

import json
import mimetypes
import re
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import comfy, datapack, db, host, native, pages, paths, repo, settings, state, storage, thumbs

MAX_BODY = 40 * 1024 * 1024
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("font/woff2", ".woff2")
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

ROUTES: list[tuple[str, re.Pattern, callable]] = []


def route(method: str, pattern: str):
    def deco(fn):
        ROUTES.append((method, re.compile("^" + pattern + "$"), fn))
        return fn
    return deco


class Request:
    def __init__(self, handler: "Handler", method: str):
        self.h = handler
        self.method = method
        parsed = urllib.parse.urlsplit(handler.path)
        self.path = urllib.parse.unquote(parsed.path)
        self.query = {k: v[-1] for k, v in urllib.parse.parse_qs(parsed.query, keep_blank_values=True).items()}
        self._body = None

    def body(self) -> bytes:
        if self._body is None:
            n = int(self.h.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                raise ValueError("요청이 너무 큽니다.")
            self._body = self.h.rfile.read(n) if n > 0 else b""
        return self._body

    def json(self) -> dict:
        raw = self.body()
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError:
            raise ValueError("JSON 형식이 올바르지 않습니다.")
        return data if isinstance(data, dict) else {}


class Response:
    def __init__(self, body: bytes = b"", status: int = 200, ctype: str = "text/html; charset=utf-8",
                 headers: dict | None = None, file: Path | None = None):
        self.body, self.status, self.ctype, self.headers, self.file = body, status, ctype, headers or {}, file


def html(text: str, status: int = 200) -> Response:
    return Response(text.encode("utf-8"), status, "text/html; charset=utf-8", {"Cache-Control": "no-store"})


def js(data, status: int = 200) -> Response:
    return Response(json.dumps(data, ensure_ascii=False).encode("utf-8"), status,
                    "application/json; charset=utf-8", {"Cache-Control": "no-store"})


def ok(**kw) -> Response:
    return js({"ok": True, **kw})


def fail(message: str, status: int = 200) -> Response:
    return js({"ok": False, "message": message}, status)


def redirect(url: str) -> Response:
    return Response(b"", 302, "text/plain", {"Location": url})


def serve_file(base: Path, rel: str, cache: str = "public, max-age=3600") -> Response:
    base = base.resolve()
    target = (base / rel).resolve()
    if base not in target.parents or not target.is_file():
        return Response(b"Not found", 404, "text/plain")
    ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return Response(status=200, ctype=ctype, headers={"Cache-Control": cache}, file=target)


# ---------------------------------------------------------------- 페이지

@route("GET", "/")
def _home(req):
    return redirect("/builder")


@route("GET", "/builder")
def _builder(req):
    restore = None
    job_id = req.query.get("from_job", "")
    if job_id.isdigit():
        restore = comfy.job_state(int(job_id))
    tpl = req.query.get("template", "")
    return html(pages.builder_page(restore_state=restore, tab=req.query.get("tab", ""),
                                   open_template=int(tpl) if tpl.isdigit() else 0))


@route("GET", "/templates")
def _templates(req):
    return html(pages.templates_page())


@route("GET", r"/templates/(new|\d+)")
def _template_editor(req, tid):
    data = None
    if tid != "new":
        data = repo.template_for_editor(int(tid))
        if not data:
            return redirect("/templates")
    return html(pages.template_editor_page(data))


@route("GET", "/gallery")
def _gallery(req):
    return html(pages.gallery_page())


@route("GET", "/elements")
def _elements(req):
    return html(pages.elements_page())


@route("GET", "/(server|workflows|lora|data|help|about)")
def _settings_section(req, section):
    return html(pages.settings_page(section))


@route("GET", "/settings")
def _settings(req):
    """예전 주소 (/settings#data 등): 메인 메뉴로 옮긴 화면으로 보낸다."""
    return html(pages.settings_redirect_page())


# ---------------------------------------------------------------- 정적 파일

@route("GET", r"/static/(.+)")
def _static(req, rel):
    return serve_file(paths.STATIC_DIR, rel, "no-cache")


@route("GET", r"/media/(.+)")
def _media(req, rel):
    return serve_file(paths.MEDIA_DIR, rel, "public, max-age=86400")


@route("GET", r"/outputs/(.+)")
def _outputs(req, rel):
    return serve_file(paths.OUTPUT_DIR, rel, "public, max-age=86400")


@route("GET", r"/thumbs/(.+)")
def _thumbs(req, rel):
    """생성 이미지의 썸네일 (없으면 만든다). 만들 수 없으면 원본을 보낸다."""
    t = thumbs.ensure(rel)
    if t is None:
        return serve_file(paths.OUTPUT_DIR, rel, "no-cache")
    return serve_file(thumbs.root(), t.relative_to(thumbs.root()).as_posix(), "no-cache")


@route("GET", "/favicon.ico")
def _favicon(req):
    return serve_file(paths.STATIC_DIR, "img/icon-64.png")


# ---------------------------------------------------------------- 빌더 API

@route("GET", r"/api/template/(\d+)")
def _api_template(req, tid):
    t = repo.get_template_for_builder(int(tid))
    return ok(template=t) if t else fail("템플릿을 찾을 수 없습니다.", 404)


@route("GET", "/api/outfit/types")
def _api_outfit_types(req):
    return ok(types=repo.outfit_types())


@route("GET", "/api/outfit/items")
def _api_outfit_items(req):
    return ok(items=repo.outfit_items(req.query.get("type", "").strip() or None))


@route("GET", "/api/places")
def _api_places(req):
    return ok(items=repo.place_items())


@route("POST", "/api/state")
def _api_state(req):
    data = req.json()
    state.save(data.get("state"))
    return ok()


# ---------------------------------------------------------------- ComfyUI API

@route("GET", "/api/comfy/status")
def _api_comfy_status(req):
    payload = comfy.jobs_payload(int(req.query.get("limit") or 300))
    payload.update(comfy.server_status())
    return js(payload)


@route("POST", r"/api/comfy/(\w+)")
def _api_comfy_action(req, action):
    data = req.json()
    job_id = int(data.get("job_id") or 0)
    if action == "enqueue":
        return js(comfy.enqueue(data))
    if action == "regenerate":
        return js(comfy.regenerate(job_id, int(data.get("count") or 1)))
    if action in ("cancel", "stop"):
        return js(comfy.cancel(job_id))
    if action == "cancel_all":
        return js(comfy.cancel_all())
    if action == "delete":
        ids = data.get("ids") or ([job_id] if job_id else [])
        return js(comfy.delete_jobs(ids, remove_files=data.get("remove_files", True) is not False))
    if action == "clear_failed":
        return js(comfy.clear_failed())
    if action == "ping":
        try:
            return js(comfy.ping(str(data.get("url") or "")))
        except comfy.ComfyError as e:
            return fail(str(e))
    if action == "reveal":
        rel = str(data.get("file") or "")
        target = (paths.OUTPUT_DIR / rel).resolve() if rel else paths.OUTPUT_DIR
        if target != paths.OUTPUT_DIR.resolve() and paths.OUTPUT_DIR.resolve() not in target.parents:
            return fail("잘못된 경로입니다.")
        open_in_finder(target)
        return ok()
    return fail("알 수 없는 작업입니다.")


def open_in_finder(target: Path) -> None:
    """Finder(macOS) · 파일 탐색기(Windows)로 보여 준다."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.is_file():
        target.mkdir(parents=True, exist_ok=True)
    native.reveal(target)


# ---------------------------------------------------------------- 템플릿 만들기 API

@route("POST", "/api/templates/save")
def _api_template_save(req):
    tid = repo.save_template(req.json())
    return ok(id=tid)


@route("POST", r"/api/templates/(\d+)/(style|delete|duplicate)")
def _api_template_action(req, tid, action):
    tid = int(tid)
    data = req.json()
    if action == "style":
        return ok(**repo.set_style(tid, int(data.get("style_id") or 0)))
    if action == "duplicate":
        return ok(id=repo.duplicate_template(tid))
    repo.delete_template(tid)
    return ok()


# ---------------------------------------------------------------- 설정 API

@route("POST", "/api/settings")
def _api_settings(req):
    return ok(settings=settings.save(req.json()))


@route("POST", "/api/workflows/upload")
def _api_wf_upload(req):
    data = req.json()
    wf = comfy.save_workflow(str(data.get("file_name") or "workflow.json"), str(data.get("text") or ""),
                             overwrite=bool(data.get("overwrite")))
    return ok(id=wf["id"], file_name=wf["file_name"])


@route("POST", "/api/workflows/delete")
def _api_wf_delete(req):
    return ok() if comfy.delete_workflow(str(req.json().get("id") or "")) else fail("workflow를 찾을 수 없습니다.")


@route("POST", "/api/workflows/rename")
def _api_wf_rename(req):
    data = req.json()
    wf = comfy.rename_workflow(str(data.get("id") or ""), str(data.get("name") or ""))
    return ok(id=wf["id"], file_name=wf["file_name"])


@route("GET", r"/api/workflows/(wf_\w+)/download")
def _api_wf_download(req, wid):
    wf = comfy.find_workflow(wid)
    if not wf:
        return Response(b"Not found", 404, "text/plain")
    return Response(wf["json"].encode("utf-8"), 200, "application/json",
                    {"Content-Disposition": "attachment; filename*=UTF-8''" + urllib.parse.quote(wf["file_name"])})


@route("POST", "/api/lora/save")
def _api_lora_save(req):
    return ok(idx=repo.save_lora(req.json()))


@route("POST", "/api/lora/delete")
def _api_lora_delete(req):
    repo.delete_lora(int(req.json().get("idx") or 0))
    return ok()


@route("GET", "/api/styles")
def _api_styles(req):
    return ok(items=pages.style_items())


@route("POST", "/api/styles/save")
def _api_style_save(req):
    data = req.json()
    return ok(id=repo.save_style(int(data.get("id") or 0), str(data.get("label") or "")))


@route("POST", "/api/styles/delete")
def _api_style_delete(req):
    repo.delete_style(int(req.json().get("id") or 0))
    return ok()


@route("GET", "/api/settings/data")
def _api_settings_data(req):
    return ok(**pages.settings_boot())


@route("POST", "/api/data/backup")
def _api_backup(req):
    target = backup_db()
    return ok(name=target.name if target else "")


@route("GET", "/api/data/backups")
def _api_backups(req):
    return ok(items=list_backups())


@route("POST", "/api/data/restore")
def _api_restore(req):
    import sqlite3
    name = str(req.json().get("name") or "")
    folder = paths.BACKUP_DIR.resolve()
    src = (folder / name).resolve()
    if src.parent != folder or not src.is_file():
        return fail("백업 파일을 찾을 수 없습니다.")
    with _data_lock:
        before = backup_db("before-restore")
        conn = sqlite3.connect(str(src))
        conn.backup(db.get())  # 실행 중인 DB에 그대로 덮어쓴다 (다른 연결도 새 내용을 본다)
        conn.close()
    return ok(before=before.name if before else "")


# ---------------------------------------------------------------- 데이터 묶음 (종류별 내보내기·가져오기·비우기)

@route("GET", "/api/data/packs")
def _api_packs(req):
    return ok(items=datapack.summary(), jobs=db.scalar("SELECT COUNT(*) FROM comfy_jobs", (), 0))


def _id_list(v) -> list[int] | None:
    return None if v is None else [int(i) for i in v if str(i).isdigit()]


def _str_list(v) -> list[str] | None:
    return None if v is None else [str(i) for i in v]


@route("POST", r"/api/data/(export|import|inspect|clear)")
def _api_pack(req, action):
    data = req.json()
    kind = str(data.get("kind") or "")
    k = datapack.check_kind(kind)
    # path는 보통 비워 두고 앱이 저장·열기 대화상자로 묻는다 (점검용, 그리고 inspect로 고른 파일을 import에 넘길 때 쓴다)
    path = str(data.get("path") or "").strip()
    types = _str_list(data.get("types"))  # 프롬프트 요소: 고른 종류만 (없으면 전부)
    if action == "export":
        styles = _id_list(data.get("styles"))  # 템플릿: 고른 스타일만 (없으면 전부)
        path = path or host.save_file(datapack.default_name(kind, styles, types), f"{k['label']} 내보내기")
        if not path:
            return ok(cancelled=True)
        if not Path(path).expanduser().is_absolute():
            return fail("전체 경로를 입력하세요.")
        with _data_lock:
            return ok(**datapack.export(kind, Path(path), styles, types))
    if action in ("import", "inspect"):
        path = path or host.open_file(f"{k['label']} 가져오기")
        if not path:
            return ok(cancelled=True)
        if action == "inspect":
            return ok(**datapack.inspect_pack(kind, Path(path)))
        with _data_lock:
            return ok(**datapack.import_pack(kind, Path(path), before=lambda: backup_db(f"before-import-{kind}"),
                                             styles=_str_list(data.get("styles")), types=types))
    with _data_lock:
        before = backup_db(f"before-clear-{kind}")
        res = datapack.clear(kind)
    return ok(**res, backup=before.name if before else "")


# ---------------------------------------------------------------- 프롬프트 요소 (등록 · 수정 · 삭제)

@route("GET", "/api/elements")
def _api_elements(req):
    return ok(items=repo.element_list(), types=repo.element_types())


@route("POST", "/api/elements/save")
def _api_element_save(req):
    with _data_lock:
        eid = repo.save_element(req.json())
    return ok(id=eid, items=repo.element_list(), types=repo.element_types())


@route("POST", "/api/elements/delete")
def _api_element_delete(req):
    with _data_lock:
        n = repo.delete_elements(_id_list(req.json().get("ids")) or [])
    return ok(removed=n, items=repo.element_list(), types=repo.element_types())


@route("POST", "/api/data/reveal")
def _api_reveal(req):
    target = Path(str(req.json().get("path") or "")).expanduser()
    if not target.is_absolute() or not target.is_file():
        return fail("파일을 찾을 수 없습니다.")
    open_in_finder(target)
    return ok()


@route("POST", "/api/data/backup-delete")
def _api_backup_delete(req):
    name = str(req.json().get("name") or "")
    folder = paths.BACKUP_DIR.resolve()
    target = (folder / name).resolve()
    if target.parent != folder or not target.is_file():
        return fail("백업 파일을 찾을 수 없습니다.")
    target.unlink()
    return ok()


def list_backups() -> list[dict]:
    from datetime import datetime
    folder = paths.BACKUP_DIR
    if not folder.is_dir():
        return []
    out = []
    for f in sorted(folder.glob("*.sqlite3"), key=lambda p: p.stat().st_mtime, reverse=True):
        st = f.stat()
        out.append({"name": f.name, "size": st.st_size,
                    "modified": datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M")})
    return out


def backup_db(tag: str = "") -> Path | None:
    """현재 DB를 저장 위치의 backups/ 폴더에 복사 (sqlite 온라인 백업)."""
    import sqlite3
    from datetime import datetime
    if not paths.DB_PATH.exists():
        return None
    folder = paths.BACKUP_DIR
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"pb-{datetime.now().strftime('%Y%m%d-%H%M%S')}{'-' + tag if tag else ''}.sqlite3"
    dst = sqlite3.connect(str(target))
    db.get().backup(dst)
    dst.close()
    return target


@route("GET", "/api/storage")
def _api_storage(req):
    return ok(**storage.info(), can_restart=host.has("restart"))


@route("POST", "/api/storage/choose")
def _api_storage_choose(req):
    start = str(req.json().get("start") or paths.DATA_DIR.parent)
    return ok(path=host.choose_folder(start))


@route("POST", "/api/storage/change")
def _api_storage_change(req):
    data = req.json()
    res = storage.request_change(str(data.get("path") or ""), "use" if data.get("mode") == "use" else "move")
    return ok(**res, can_restart=host.has("restart"))


@route("POST", "/api/storage/cancel")
def _api_storage_cancel(req):
    storage.cancel_change()
    return ok()


@route("POST", "/api/storage/clear-error")
def _api_storage_clear_error(req):
    storage.clear_error()
    return ok()


@route("POST", "/api/app/restart")
def _api_restart(req):
    if not host.restart():
        return fail("창 없이 실행 중이라 자동으로 다시 시작할 수 없습니다. 앱을 끄고 다시 실행하세요.")
    return ok()


@route("POST", "/api/data/open")
def _api_data_open(req):
    which = str(req.json().get("which") or "outputs")
    target = {"outputs": paths.OUTPUT_DIR, "workflows": paths.WORKFLOW_DIR, "data": paths.DATA_DIR}.get(which)
    if not target:
        return fail("알 수 없는 폴더입니다.")
    open_in_finder(target)
    return ok()


_data_lock = threading.Lock()


# ---------------------------------------------------------------- 서버

class Handler(BaseHTTPRequestHandler):
    server_version = f"LOOM/{paths.APP_VERSION}"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # 조용히
        pass

    def _allowed_host(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0].strip("[]")
        return host in ("127.0.0.1", "localhost", "::1")

    def _same_origin_post(self) -> bool:
        """다른 사이트가 브라우저를 통해 API를 부르지 못하게: 이 앱 화면은 항상 JSON으로, 같은 주소에서 보낸다."""
        origin = self.headers.get("Origin")
        if origin is not None and urllib.parse.urlsplit(origin).hostname not in ("127.0.0.1", "localhost", "::1"):
            return False
        return (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() == "application/json"

    def _handle(self, method: str):
        if not self._allowed_host():
            self._send(Response(b"Forbidden", 403, "text/plain"))
            return
        req = Request(self, method)
        if method == "POST" and req.path.startswith("/api/") and not self._same_origin_post():
            self._send(fail("허용되지 않은 요청입니다.", 403))
            return
        for m, pattern, fn in ROUTES:
            if m != method:
                continue
            match = pattern.match(req.path)
            if not match:
                continue
            try:
                res = fn(req, *match.groups())
            except ValueError as e:
                res = fail(str(e)) if req.path.startswith("/api/") else html(pages.error_page(str(e)), 400)
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                res = fail(f"오류: {e}", 500) if req.path.startswith("/api/") else html(pages.error_page(str(e)), 500)
            self._send(res)
            return
        self._send(Response(b"Not found", 404, "text/plain"))

    def _send(self, res: Response):
        try:
            if res.file is not None:
                size = res.file.stat().st_size
                self.send_response(res.status)
                self.send_header("Content-Type", res.ctype)
                self.send_header("Content-Length", str(size))
                for k, v in res.headers.items():
                    self.send_header(k, v)
                self.end_headers()
                if self.command != "HEAD":
                    with open(res.file, "rb") as f:
                        while True:
                            chunk = f.read(256 * 1024)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                return
            self.send_response(res.status)
            self.send_header("Content-Type", res.ctype)
            self.send_header("Content-Length", str(len(res.body)))
            for k, v in res.headers.items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(res.body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        self._handle("GET")

    def do_HEAD(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def start(port: int = 0) -> tuple[Server, int]:
    """서버를 백그라운드 스레드로 띄우고 (server, port)를 돌려준다."""
    paths.ensure_dirs()
    db.get()
    try:
        srv = Server(("127.0.0.1", port), Handler)
    except OSError:
        srv = Server(("127.0.0.1", 0), Handler)
    t = threading.Thread(target=srv.serve_forever, name="http", daemon=True)
    t.start()
    if not comfy.worker.is_alive():
        comfy.worker.start()
    return srv, srv.server_address[1]
