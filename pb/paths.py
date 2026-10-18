"""앱 경로 모음.

- 프로그램 파일(static 등)은 앱 번들 안에 있다 (소스로 실행할 때는 이 폴더).
- 사용자 데이터(DB·이미지·workflow·생성 결과)는 사용자가 정한 저장 위치에 있다. 기본: 문서/LOOM
- 저장 위치를 가리키는 설정과 창(웹뷰) 저장소는 macOS ~/Library/Application Support/LOOM,
  Windows %LOCALAPPDATA%\\LOOM 에 둔다 (OS별 위치는 native.py).
- 이름을 바꾸기 전(Prompt Builder, macOS)의 설정 · 기록 · 기본 저장 위치는 storage가 새 이름으로 옮긴다.
저장 위치는 storage.resolve()가 실행 초기에 configure()로 정한다.
"""
from __future__ import annotations

import sys
from pathlib import Path

from . import brand, native

APP_NAME = brand.NAME
APP_VERSION = "1.4"
FROZEN = bool(getattr(sys, "frozen", False))
APP_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
STATIC_DIR = APP_DIR / "static"

HOME = Path.home()
CONFIG_DIR = native.config_dir(APP_NAME)
WEBVIEW_DIR = CONFIG_DIR / "webview"
LOG_PATH = native.log_path(APP_NAME)
DEFAULT_DATA_DIR = native.documents_dir() / APP_NAME
# 이름을 바꾸기 전(1.3까지, macOS만)의 앱 이름과 위치. 다른 OS에서는 없는 경로라 아무것도 하지 않는다
LEGACY_NAME = "Prompt Builder"
LEGACY_CONFIG_DIR = HOME / "Library" / "Application Support" / LEGACY_NAME
LEGACY_LOG_PATH = HOME / "Library" / "Logs" / f"{LEGACY_NAME}.log"
LEGACY_DATA_DIR = HOME / "Documents" / LEGACY_NAME

MEDIA_FOLDERS = ("outfit", "outfit_krea", "places", "places_krea", "template_preview")
DB_NAME = "pb.sqlite3"

# configure()가 채운다
DATA_DIR: Path
DB_PATH: Path
SETTINGS_PATH: Path
STATE_PATH: Path
WORKFLOW_DIR: Path
OUTPUT_DIR: Path
MEDIA_DIR: Path
BACKUP_DIR: Path


def configure(data_dir: Path) -> None:
    global DATA_DIR, DB_PATH, SETTINGS_PATH, STATE_PATH, WORKFLOW_DIR, OUTPUT_DIR, MEDIA_DIR, BACKUP_DIR
    DATA_DIR = Path(data_dir).expanduser()
    DB_PATH = DATA_DIR / DB_NAME
    SETTINGS_PATH = DATA_DIR / "settings.json"
    STATE_PATH = DATA_DIR / "builder_state.json"
    WORKFLOW_DIR = DATA_DIR / "workflows"
    OUTPUT_DIR = DATA_DIR / "outputs"
    MEDIA_DIR = DATA_DIR / "media"
    BACKUP_DIR = DATA_DIR / "backups"


configure(DEFAULT_DATA_DIR)


def ensure_dirs() -> None:
    for d in (DATA_DIR, WORKFLOW_DIR, OUTPUT_DIR, MEDIA_DIR, BACKUP_DIR, *(MEDIA_DIR / f for f in MEDIA_FOLDERS)):
        d.mkdir(parents=True, exist_ok=True)
