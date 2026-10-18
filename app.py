#!/usr/bin/env python3
"""LOOM — Prompt Builder for ComfyUI. 단어를 엮어, 이미지를 짓다.

  LOOM.app                             # 독립 실행 앱 (tools/build_app.py로 만든다)
  .venv/bin/python app.py              # 소스로 실행: 앱 창 (PySide6 · QtWebEngine)
  .venv/bin/python app.py --browser    # 기본 브라우저로 열기
  .venv/bin/python app.py --server     # 서버만 (개발용)
  .venv/bin/python app.py --server --port=47990 --data-dir=/tmp/pbtest   # 실행 중인 앱과 별개로 점검
  (Windows: .venv\\Scripts\\python app.py · 콘솔 창 없이 .venv\\Scripts\\pythonw app.py)

웹과 연동하지 않는다. 화면은 127.0.0.1에서만 열리고, 데이터는 사용자가 정한 저장 위치
(기본: 문서/LOOM)에만 저장한다. macOS · Windows에서 동작한다 (OS별 차이는 pb/native.py).
"""
from __future__ import annotations

import os
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pb import native, paths  # noqa: E402

APP_NAME = paths.APP_NAME
DEFAULT_PORT = 47821
_lock_file = None


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def setup_logging(isolated: bool = False) -> None:
    """앱(.app · pythonw)으로 실행되면 출력을 기록 파일(paths.LOG_PATH)로 보낸다.
    isolated(--data-dir 점검 실행)는 실제 기록 파일을 건드리지 않고 그대로 출력한다."""
    tty = sys.stdout is not None and hasattr(sys.stdout, "isatty") and sys.stdout.isatty()
    if (tty or isolated) and "--log" not in sys.argv:
        return
    paths.LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    f = open(paths.LOG_PATH, "a", buffering=1, encoding="utf-8")
    sys.stdout = sys.stderr = f


def acquire_lock(wait: float) -> bool:
    """한 번에 하나만 실행 (생성 대기열을 두 번 처리하지 않도록)."""
    global _lock_file
    paths.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    _lock_file = open(paths.CONFIG_DIR / "instance.lock", "a")
    deadline = time.time() + wait
    while not native.try_lock(_lock_file):
        if time.time() >= deadline:
            return False
        time.sleep(0.3)
    return True


def alert(msg: str) -> None:
    """창을 띄우기 전에 알릴 일 (macOS 앱 · Windows는 대화상자로)."""
    log(msg)
    if paths.FROZEN or native.WINDOWS:
        native.alert(APP_NAME, msg)


def prepare_data(override: str = "") -> None:
    """저장 위치를 정하고(예약된 이동·예전 데이터 이동 포함) DB를 준비한다.
    override(--data-dir=)는 개발·점검용: 설정을 건드리지 않고 그 폴더만 쓴다."""
    from pb import db, storage
    if override:
        storage.OVERRIDE = True
        paths.configure(Path(override).expanduser())
        paths.WEBVIEW_DIR = paths.DATA_DIR / "webview"  # 창 저장소도 점검 폴더 안에
        where = paths.DATA_DIR
    else:
        where = storage.resolve(log)
    log(f"저장 위치: {where}")
    paths.ensure_dirs()
    db.get()  # 처음 실행이면 빈 DB를 만든다. 데이터(템플릿 · 요소 · 의상 · 배경)는 따로 받은 zip을 데이터 메뉴에서 가져온다


def start_server(port: int):
    from pb import server
    return server.start(port)


def run_browser(port: int) -> None:
    _, port = start_server(port)
    url = f"http://127.0.0.1:{port}/builder"
    log(f"{APP_NAME}: {url}  (종료: Ctrl+C)")
    webbrowser.open(url)
    _wait_forever()


def run_server(port: int) -> None:
    _, port = start_server(port)
    log(f"{APP_NAME} 서버: http://127.0.0.1:{port}/builder  (종료: Ctrl+C)")
    _wait_forever()


def _wait_forever() -> None:
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


def _set_mac_app_name(name: str) -> None:
    """메뉴 막대에 'Python' 대신 앱 이름이 보이도록 (pyobjc가 있을 때만)."""
    try:
        from Foundation import NSBundle
        info = NSBundle.mainBundle().localizedInfoDictionary() or NSBundle.mainBundle().infoDictionary()
        if info is not None:
            info["CFBundleName"] = name
    except Exception:
        pass


def run_window(port: int, selftest: bool = False) -> None:
    if native.MAC:
        _set_mac_app_name(APP_NAME)
    if native.WINDOWS:  # 작업 표시줄에 python 대신 LOOM 아이콘이 보이도록
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("mif.LOOM")
        except Exception:  # noqa: BLE001
            pass
    from PySide6.QtCore import QObject, QProcess, QSettings, QStandardPaths, Qt, QTimer, QUrl, Signal
    from PySide6.QtGui import QAction, QColor, QDesktopServices, QIcon, QKeySequence, QPixmap
    from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineSettings
    from PySide6.QtWebEngineWidgets import QWebEngineView
    from PySide6.QtWidgets import QApplication, QFileDialog, QMainWindow

    from pb import brand, host, storage
    from pb.about import AboutDialog
    from pb.icon import draw_icon

    os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--disable-features=Translate")
    app = QApplication(sys.argv)
    app.setApplicationName(APP_NAME)
    app.setApplicationDisplayName(APP_NAME)
    # Qt 자체 저장소(~/Library/Application Support/<조직>/<앱>)가 CONFIG_DIR(…/LOOM)과 겹치지 않게
    # 조직 이름은 앱 이름과 다르게 둔다 (macOS 디스크는 대소문자를 가리지 않는다)
    app.setOrganizationName("mif")
    app.setWindowIcon(QIcon(QPixmap.fromImage(draw_icon(512))))

    class Bridge(QObject):
        """서버 스레드의 요청을 화면(메인) 스레드에서 실행한다."""
        request = Signal(object)

        def __init__(self):
            super().__init__()
            self.request.connect(self._run, Qt.QueuedConnection)

        def _run(self, job):
            fn, box, ev = job
            try:
                box["result"] = fn()
            except Exception as e:  # noqa: BLE001
                box["error"] = e
            ev.set()

        def call(self, fn, timeout: float = 900):
            if threading.current_thread() is threading.main_thread():
                return fn()
            box, ev = {}, threading.Event()
            self.request.emit((fn, box, ev))
            ev.wait(timeout)
            if "error" in box:
                raise box["error"]
            return box.get("result")

    bridge = Bridge()
    _, port = start_server(port)
    base = f"http://127.0.0.1:{port}"

    profile = QWebEngineProfile("LOOM", app)
    paths.WEBVIEW_DIR.mkdir(parents=True, exist_ok=True)
    profile.setPersistentStoragePath(str(paths.WEBVIEW_DIR / "storage"))
    profile.setCachePath(str(paths.WEBVIEW_DIR / "cache"))
    profile.setHttpCacheMaximumSize(256 * 1024 * 1024)
    s = profile.settings()
    for attr in ("JavascriptCanAccessClipboard", "JavascriptCanPaste", "LocalStorageEnabled"):
        a = getattr(QWebEngineSettings.WebAttribute, attr, None)
        if a is not None:
            s.setAttribute(a, True)

    def is_local(url: QUrl) -> bool:
        if url.scheme() in ("about", "data", "blob"):
            return True
        return url.scheme() in ("http", "https") and url.host() in ("127.0.0.1", "localhost") and url.port() == port

    class Page(QWebEnginePage):
        def acceptNavigationRequest(self, url, nav_type, is_main_frame):
            if is_local(url):
                return True
            # 외부 주소(LoRA 링크 등)는 앱 안에서 열지 않고 기본 브라우저로 넘긴다
            QDesktopServices.openUrl(url)
            return False

        def createWindow(self, _type):
            tmp = QWebEnginePage(profile, self)

            def route(url):
                if is_local(url):
                    self.setUrl(url)
                else:
                    QDesktopServices.openUrl(url)
                tmp.deleteLater()
            tmp.urlChanged.connect(route)
            return tmp

    class Window(QMainWindow):
        def __init__(self):
            super().__init__()
            self.setWindowTitle(APP_NAME)
            self.view = QWebEngineView(self)
            self.page = Page(profile, self.view)
            self.page.setBackgroundColor(QColor("#121213"))
            self.view.setPage(self.page)
            self.setCentralWidget(self.view)
            self.setMinimumSize(1080, 680)
            # --data-dir 점검 실행은 창 위치도 점검 폴더에 (실제 앱 설정을 건드리지 않게)
            self.qs = (QSettings(str(paths.DATA_DIR / "window.ini"), QSettings.IniFormat) if storage.OVERRIDE
                       else QSettings())
            # 이름을 바꾸기 전(Prompt Builder)에 저장한 창 크기 · 위치를 이어 쓴다
            geo = self.qs.value("geometry") or QSettings("promptbuilder", paths.LEGACY_NAME).value("geometry")
            if geo is not None:
                self.restoreGeometry(geo)
            else:
                self.resize(1560, 980)
            self.page.titleChanged.connect(lambda t: self.setWindowTitle(t or APP_NAME))
            self.view.load(QUrl(base + "/builder"))
            self._menus()

        def _menus(self):
            bar = self.menuBar()
            go = bar.addMenu("이동")
            # 사이드바(메인 메뉴)와 같은 순서. None은 구분선
            for entry in (("빌더", "/builder", "Ctrl+B"), ("갤러리", "/gallery", "Ctrl+G"),
                          ("템플릿 만들기", "/templates", "Ctrl+T"), ("프롬프트 요소", "/elements", "Ctrl+E"), None,
                          ("ComfyUI 서버", "/server", "Ctrl+,"), ("Workflow", "/workflows", ""),
                          ("LoRA", "/lora", ""), ("데이터", "/data", "Ctrl+D")):
                if entry is None:
                    go.addSeparator()
                    continue
                label, path, key = entry
                act = QAction(label, self)
                if key:
                    act.setShortcut(QKeySequence(key))
                act.setMenuRole(QAction.NoRole)  # macOS가 앱 메뉴(환경설정 등)로 옮기지 않게
                act.triggered.connect(lambda _=False, p=path: self.view.load(QUrl(base + p)))
                go.addAction(act)
            view = bar.addMenu("보기")
            for label, key, fn in (("새로고침", QKeySequence.Refresh, lambda: self.view.reload()),
                                   ("크게", QKeySequence.ZoomIn, lambda: self.view.setZoomFactor(min(2.0, self.view.zoomFactor() + 0.1))),
                                   ("작게", QKeySequence.ZoomOut, lambda: self.view.setZoomFactor(max(0.6, self.view.zoomFactor() - 0.1))),
                                   ("원래 크기", QKeySequence("Ctrl+0"), lambda: self.view.setZoomFactor(1.0))):
                act = QAction(label, self)
                act.setShortcut(key)
                act.triggered.connect(fn)
                view.addAction(act)
            folder = bar.addMenu("폴더")
            for label, attr in (("생성 이미지 폴더", "OUTPUT_DIR"), ("workflow 폴더", "WORKFLOW_DIR"),
                                ("저장 위치 (데이터 폴더)", "DATA_DIR")):
                act = QAction(label, self)
                act.triggered.connect(lambda _=False, a=attr: QDesktopServices.openUrl(QUrl.fromLocalFile(str(getattr(paths, a)))))
                folder.addAction(act)
            # 도움말: 사용법 · 웹사이트 · 홈페이지 · 블로그 · GitHub · 정보 (LUMIQ Studio와 같은 구성)
            hlp = bar.addMenu("도움말")
            guide = QAction(f"{APP_NAME} 사용법", self)
            guide.setShortcut(QKeySequence.HelpContents)
            guide.triggered.connect(lambda: self.view.load(QUrl(base + "/help")))
            hlp.addAction(guide)
            hlp.addSeparator()
            for label, url in brand.LINKS:
                act = QAction(f"{label}  ·  {brand.short_url(url)}", self)
                act.triggered.connect(lambda _=False, u=url: QDesktopServices.openUrl(QUrl(u)))
                hlp.addAction(act)
            hlp.addSeparator()
            about = QAction(f"{APP_NAME} 정보", self)
            about.setMenuRole(QAction.AboutRole)  # macOS: 앱 메뉴 맨 위의 'LOOM 정보'
            about.triggered.connect(lambda: AboutDialog(self, paths.APP_VERSION).exec())
            hlp.addAction(about)

        def closeEvent(self, e):
            self.qs.setValue("geometry", self.saveGeometry())
            super().closeEvent(e)

    win = Window()

    # 서버가 빌려 쓰는 창 기능: 폴더·파일 고르기, 다시 시작
    def choose_folder(start: str) -> str:
        def ask():
            win.raise_()
            win.activateWindow()
            return QFileDialog.getExistingDirectory(win, "데이터 저장 위치 선택", start or str(Path.home()),
                                                    QFileDialog.ShowDirsOnly)
        return bridge.call(ask) or ""

    PACK_FILTER = f"{APP_NAME} 데이터 (*.zip)"

    def save_file(title: str, suggested: str) -> str:
        def ask():
            win.raise_()
            win.activateWindow()
            return QFileDialog.getSaveFileName(win, title, suggested, PACK_FILTER)[0]
        return bridge.call(ask) or ""

    def open_file(title: str, start: str) -> str:
        def ask():
            win.raise_()
            win.activateWindow()
            return QFileDialog.getOpenFileName(win, title, start, PACK_FILTER)[0]
        return bridge.call(ask) or ""

    def restart() -> None:
        def go():
            win.qs.setValue("geometry", win.saveGeometry())
            args = [a for a in sys.argv[1:] if a not in ("--restarted", "--selftest")] + ["--restarted"]
            if paths.FROZEN:
                QProcess.startDetached(sys.executable, args)
            else:
                QProcess.startDetached(sys.executable, [str(ROOT / "app.py")] + args)
            app.quit()
        bridge.request.emit((lambda: QTimer.singleShot(300, go), {}, threading.Event()))

    host.register("choose_folder", choose_folder)
    host.register("save_file", save_file)
    host.register("open_file", open_file)
    host.register("restart", restart)

    def on_download(item):
        downloads = QStandardPaths.writableLocation(QStandardPaths.DownloadLocation) or str(Path.home() / "Downloads")
        item.setDownloadDirectory(downloads)
        item.accept()

        def finished():
            name = item.downloadFileName()
            win.page.runJavaScript(f"window.PB && PB.toast({name!r} + ' 을(를) 다운로드 폴더에 저장했습니다.')")
        item.isFinishedChanged.connect(lambda: item.isFinished() and finished())

    profile.downloadRequested.connect(on_download)

    # 독(Windows는 작업 표시줄) 아이콘 배지: 생성 중 + 대기 작업 수. 0이면 지운다
    from pb import comfy
    badge = {"n": 0}

    def update_badge():
        try:
            n = comfy.active_count()
        except Exception:  # noqa: BLE001
            return
        if n != badge["n"]:
            badge["n"] = n
            app.setBadgeNumber(n)

    badge_timer = QTimer(win)
    badge_timer.timeout.connect(update_badge)
    badge_timer.start(1500)
    update_badge()

    if selftest:
        def report():
            js = ("document.title + ' | ' + location.pathname + ' | templates=' + document.querySelectorAll('.tcard').length"
                  " + ' | static=' + !!document.querySelector('link[href*=\"app.css\"]')")
            win.page.runJavaScript(js, 0, lambda r: (log(f"SELFTEST {r} | data={paths.DATA_DIR}"), app.quit()))
        win.page.loadFinished.connect(lambda ok: QTimer.singleShot(2500, report))
        QTimer.singleShot(30000, app.quit)

    win.show()
    sys.exit(app.exec())


def main() -> None:
    args = sys.argv[1:]
    port = DEFAULT_PORT
    for a in args:
        if a.startswith("--port="):
            port = int(a.split("=", 1)[1])
    data_dir = next((a.split("=", 1)[1] for a in args if a.startswith("--data-dir=")), "")
    moved = []
    if not data_dir:  # --data-dir 점검 실행은 실제 설정을 건드리지 않는다
        from pb import storage
        if storage.legacy_running():
            alert(f"이름을 바꾸기 전 앱({paths.LEGACY_NAME})이 아직 켜져 있습니다.\n"
                  f"{paths.LEGACY_NAME}를 종료(⌘Q)한 뒤 {APP_NAME}을 다시 여세요.")
            return
        moved = storage.migrate_legacy()  # 기록 파일도 옮기므로 기록을 열기 전에
    setup_logging(isolated=bool(data_dir))
    for m in moved:
        log(m)
    # --data-dir 로 따로 띄우는 개발·점검용 실행은 실제 앱과 겹치지 않으므로 잠금을 쓰지 않는다
    if not data_dir and not acquire_lock(20 if "--restarted" in args else 0.8):
        if native.WINDOWS:
            alert(f"{APP_NAME}이 이미 실행 중입니다.")
        else:
            log("이미 실행 중입니다.")
            if paths.FROZEN:
                native.activate(APP_NAME)
        return
    prepare_data(data_dir)
    if "--server" in args:
        run_server(port)
    elif "--browser" in args:
        run_browser(port)
    else:
        try:
            from PySide6 import QtWebEngineWidgets  # noqa: F401
        except ImportError:
            log("PySide6(QtWebEngine)가 없어 기본 브라우저로 엽니다.")
            run_browser(port)
            return
        run_window(port, selftest="--selftest" in args)


if __name__ == "__main__":
    main()
