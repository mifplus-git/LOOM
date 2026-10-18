#!/usr/bin/env python3
"""개발용: 페이지를 QtWebEngine(앱과 같은 엔진)으로 열어 스크린샷과 콘솔 메시지를 남긴다.

  .venv/bin/python tools/shot.py URL out.png [--size=1560x980] [--wait=1500] [--js="..."] [--js2="..."]
  --js 는 로드 후 실행, --js2 는 그다음 --wait 뒤에 한 번 더 실행한다.
"""
import os
import sys

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")  # 사용자 화면에 창을 띄우지 않는다
os.environ.setdefault("QTWEBENGINE_CHROMIUM_FLAGS", "--disable-gpu")

from PySide6.QtCore import QTimer, QUrl
from PySide6.QtWebEngineCore import QWebEnginePage
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWidgets import QApplication


def main():
    url, out = sys.argv[1], sys.argv[2]
    opts = dict(a[2:].split("=", 1) for a in sys.argv[3:] if a.startswith("--") and "=" in a)
    w, h = (int(x) for x in opts.get("size", "1560x980").split("x"))
    wait = int(opts.get("wait", "1500"))
    app = QApplication(sys.argv)

    class Page(QWebEnginePage):
        def javaScriptConsoleMessage(self, level, message, line, source):
            print(f"[console:{level.name if hasattr(level, 'name') else level}] {message} ({source.split('/')[-1]}:{line})")

    view = QWebEngineView()
    page = Page(view)
    view.setPage(page)
    view.resize(w, h)
    view.show()

    def shoot():
        view.grab().save(out)
        print("saved", out)
        app.quit()

    def step2():
        if opts.get("js2"):
            page.runJavaScript(opts["js2"], 0, lambda r: print("js2 →", r))
        QTimer.singleShot(wait, shoot)

    def loaded(ok):
        print("loaded", ok)
        if opts.get("js"):
            page.runJavaScript(opts["js"], 0, lambda r: print("js →", r))
        QTimer.singleShot(wait, step2)

    page.loadFinished.connect(loaded)
    view.load(QUrl(url))
    QTimer.singleShot(30000, app.quit)
    app.exec()


if __name__ == "__main__":
    main()
