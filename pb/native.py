"""OS별 차이를 한곳에 (LUMIQ gui/native.py와 같은 역할).

설정 · 기록 위치, 문서 폴더, 한 번에 하나만 실행하는 잠금, 창을 띄우기 전 알림, 파일 위치 보기.
지원: macOS · Windows. Qt를 불러오지 않는다 (서버만 띄울 때도 쓰므로).
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

MAC = sys.platform == "darwin"
WINDOWS = sys.platform == "win32"
HOME = Path.home()


def config_dir(app: str) -> Path:
    """저장 위치 기록 · 창(웹뷰) 저장소 · 실행 잠금. macOS ~/Library/Application Support/<앱>, Windows %LOCALAPPDATA%\\<앱>."""
    if WINDOWS:
        return Path(os.environ.get("LOCALAPPDATA") or HOME / "AppData" / "Local") / app
    return HOME / "Library" / "Application Support" / app


def log_path(app: str) -> Path:
    if WINDOWS:
        return config_dir(app) / f"{app}.log"
    return HOME / "Library" / "Logs" / f"{app}.log"


def documents_dir() -> Path:
    """문서 폴더. Windows는 OneDrive 등으로 옮겨 둔 실제 위치를 묻는다."""
    if WINDOWS:
        try:
            import ctypes
            buf = ctypes.create_unicode_buffer(260)
            if ctypes.windll.shell32.SHGetFolderPathW(None, 5, None, 0, buf) == 0 and buf.value:  # 5 = CSIDL_PERSONAL
                return Path(buf.value)
        except Exception:  # noqa: BLE001  못 물으면 기본 위치
            pass
    return HOME / "Documents"


def try_lock(f) -> bool:
    """열어 둔 잠금 파일을 다른 프로세스와 겹치지 않게 잡는다 (기다리지 않음)."""
    try:
        if WINDOWS:
            import msvcrt
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def unlock(f) -> None:
    try:
        if WINDOWS:
            import msvcrt
            f.seek(0)
            msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(f, fcntl.LOCK_UN)
    except OSError:
        pass


def alert(title: str, msg: str) -> None:
    """창을 띄우기 전에 알리는 대화상자 (macOS osascript, Windows MessageBox)."""
    try:
        if WINDOWS:
            import ctypes
            ctypes.windll.user32.MessageBoxW(None, msg, title, 0x30)  # MB_ICONWARNING
        elif MAC:
            text = msg.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
            subprocess.run(["osascript", "-e", f'display dialog "{text}" buttons {{"확인"}} default button 1 '
                            f'with title "{title}" with icon caution'], check=False, capture_output=True)
    except Exception:  # noqa: BLE001  알림을 못 띄워도 기록에는 남아 있다
        pass


def activate(app: str) -> None:
    """이미 켜져 있는 앱(.app)을 앞으로 (macOS)."""
    if MAC:
        subprocess.run(["osascript", "-e", f'tell application "{app}" to activate'], check=False, capture_output=True)


def reveal(target: Path) -> None:
    """파일이면 그 파일을 고른 채로, 폴더면 폴더를 Finder · 파일 탐색기로 연다."""
    try:
        if MAC:
            subprocess.Popen(["open", "-R", str(target)] if target.is_file() else ["open", str(target)])
        elif WINDOWS:
            if target.is_file():
                subprocess.Popen(f'explorer /select,"{target}"')
            else:
                os.startfile(str(target))  # noqa: S606
    except OSError:
        pass
