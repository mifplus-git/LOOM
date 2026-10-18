"""앱 창(Qt)이 서버에 빌려주는 기능: 폴더·파일 고르기 대화상자, 앱 다시 시작.
창 없이(--browser) 실행할 때는 macOS 기본 대화상자(osascript)로 대신한다 (Windows는 앱 창에서만)."""
from __future__ import annotations

import subprocess
from pathlib import Path

_hooks: dict = {}
_last_dir = ""  # 마지막으로 내보내기·가져오기한 폴더 (이번 실행 동안)


def register(name: str, fn) -> None:
    _hooks[name] = fn


def has(name: str) -> bool:
    return name in _hooks


def choose_folder(start: str = "") -> str:
    if "choose_folder" in _hooks:
        return _hooks["choose_folder"](start) or ""
    loc = ""
    if start:
        safe = start.replace("\\", "\\\\").replace('"', '\\"')
        loc = f' default location (POSIX file "{safe}")'
    script = f'POSIX path of (choose folder with prompt "데이터 저장 위치를 고르세요"{loc})'
    try:
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return r.stdout.strip().rstrip("/") if r.returncode == 0 else ""


def _osa_path(script: str) -> str:
    try:
        r = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=600)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return r.stdout.strip() if r.returncode == 0 else ""


def _osa_str(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def _start_dir() -> str:
    if _last_dir and Path(_last_dir).is_dir():
        return _last_dir
    downloads = Path.home() / "Downloads"
    return str(downloads if downloads.is_dir() else Path.home())


def _remember(path: str) -> str:
    global _last_dir
    if path:
        _last_dir = str(Path(path).parent)
    return path


def save_file(default_name: str, title: str = "내보내기") -> str:
    """저장할 파일 경로를 묻는다 ('' = 취소)."""
    start = _start_dir()
    if "save_file" in _hooks:
        return _remember(_hooks["save_file"](title, str(Path(start) / default_name)) or "")
    script = (f'POSIX path of (choose file name with prompt "{_osa_str(title)}" default name "{_osa_str(default_name)}"'
              f' default location (POSIX file "{_osa_str(start)}"))')
    return _remember(_osa_path(script))


def open_file(title: str = "가져오기") -> str:
    """가져올 zip 파일을 고르게 한다 ('' = 취소)."""
    start = _start_dir()
    if "open_file" in _hooks:
        return _remember(_hooks["open_file"](title, start) or "")
    script = (f'POSIX path of (choose file with prompt "{_osa_str(title)}" of type {{"zip", "public.zip-archive"}}'
              f' default location (POSIX file "{_osa_str(start)}"))')
    return _remember(_osa_path(script))


def restart() -> bool:
    if "restart" in _hooks:
        _hooks["restart"]()
        return True
    return False
