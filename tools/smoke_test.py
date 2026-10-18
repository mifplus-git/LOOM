#!/usr/bin/env python3
"""설치 확인: 테스트용 데이터 폴더로 서버와 앱 창을 실제로 띄워 본다. 어느 OS에서나 같은 명령.

  .venv/bin/python tools/smoke_test.py          (Windows: .venv\\Scripts\\python tools\\smoke_test.py)

임시 폴더에만 쓰고 끝나면 지운다. --data-dir 점검 실행이라 실제 저장 위치 · 앱 설정 · 기록 파일은 건드리지 않고,
켜 둔 LOOM과 함께 돌려도 된다. 앱 창은 화면에 띄우지 않고(offscreen) 연다. 문제가 있으면 종료 코드 1.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ["/builder", "/gallery", "/templates", "/elements", "/server", "/workflows", "/lora", "/data", "/help", "/about"]

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8", errors="replace")


def check(ok: bool, text: str) -> bool:
    print(f"  {'✓' if ok else '✗'} {text}")
    return ok


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get(url: str) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except OSError:
        return 0, ""


def post(url: str, data: dict) -> dict:
    req = urllib.request.Request(url, json.dumps(data).encode("utf-8"), {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode("utf-8"))
    except (OSError, ValueError):
        return {}


def wait_up(url: str, proc: subprocess.Popen, seconds: float) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline and proc.poll() is None:
        if get(url)[0] == 200:
            return True
        time.sleep(0.5)
    return False


def app_cmd(*args: str) -> list[str]:
    return [sys.executable, str(ROOT / "app.py"), *args]


def main() -> int:
    print(f"LOOM 설치 확인 · Python {sys.version.split()[0]} · {sys.platform}")
    ok = True
    print("패키지")
    try:
        import PySide6
        check(True, f"PySide6 {PySide6.__version__}")
        from PySide6 import QtWebEngineWidgets  # noqa: F401
        check(True, "QtWebEngine (앱 창)")
    except Exception as e:  # noqa: BLE001  어떤 이유로든 못 불러오면 실패로 보고
        ok = check(False, f"PySide6: {e}")

    tmp = Path(tempfile.mkdtemp(prefix="loom_check_"))
    data = tmp / "LOOM 점검"  # 한글 · 공백이 든 경로까지 확인
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    proc = None
    try:
        print("서버")
        port = free_port()
        base = f"http://127.0.0.1:{port}"
        proc = subprocess.Popen(app_cmd("--server", f"--port={port}", f"--data-dir={data}"), cwd=ROOT, env=env,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                errors="replace")
        up = wait_up(base + "/builder", proc, 120)
        ok = check(up, f"시작 {base}") and ok
        if up:
            for path in PAGES:
                code, body = get(base + path)
                ok = check(code == 200 and "LOOM" in body, f"{path}  {code}") and ok
            code, _ = get(base + "/static/img/icon-64.png")
            ok = check(code == 200, f"아이콘  {code}") and ok
            # 앱에는 데이터가 없다: 빈 DB로 시작하고, 요소를 하나 넣었다 지워 DB에 쓸 수 있는지 본다
            with sqlite3.connect(data / "pb.sqlite3") as c:
                counts = [c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                          for t in ("prompt_template_items", "prompt_elements", "prompt_famous_places")]
            ok = check(counts == [0, 0, 0], "빈 데이터로 시작 (템플릿 · 요소 · 배경 {:,} · {:,} · {:,})".format(*counts)) and ok
            r = post(base + "/api/elements/save", {"element_type": "pose", "section": "점검", "label_ko": "점검",
                                                    "prompt": "check"})
            r2 = post(base + "/api/elements/delete", {"ids": [r.get("id")]}) if r.get("ok") else {}
            ok = check(bool(r.get("ok") and r2.get("removed") == 1), "프롬프트 요소 등록 · 삭제") and ok
        proc.terminate()
        try:
            out = proc.communicate(timeout=15)[0]
        except subprocess.TimeoutExpired:
            proc.kill()
            out = proc.communicate()[0]
        if not up:
            print("\n".join("    " + line for line in out.strip().splitlines()[-15:]))

        print("앱 창 (화면에 띄우지 않음)")
        try:
            r = subprocess.run(app_cmd("--selftest", f"--port={free_port()}", f"--data-dir={data}"), cwd=ROOT,
                               env={**env, "QT_QPA_PLATFORM": "offscreen"}, capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=180)
            out = r.stdout + r.stderr
        except subprocess.TimeoutExpired as e:
            out = str(e.stdout or "")
        line = next((ln for ln in out.splitlines() if "SELFTEST" in ln), "")
        shown = line.split("SELFTEST", 1)[-1].split("| data=")[0].strip()
        ok = check("LOOM" in line and "static=true" in line, shown or "창을 열지 못했습니다") and ok
        if not line:
            print("\n".join("    " + ln for ln in out.strip().splitlines()[-15:]))
    finally:
        if proc and proc.poll() is None:
            proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)
    print("결과:", "모두 정상" if ok else "문제가 있습니다")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
