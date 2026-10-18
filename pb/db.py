"""SQLite 연결과 스키마. 테이블 이름·컬럼은 원본(MariaDB) 구조를 그대로 따른다."""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager

from . import paths

SCHEMA = """
CREATE TABLE IF NOT EXISTS prompt_template_styles (
    id INTEGER PRIMARY KEY,
    label_ko TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS prompt_template_items (
    id INTEGER PRIMARY KEY,
    style_id INTEGER,
    user_id INTEGER,
    label_ko TEXT NOT NULL DEFAULT '',
    image_url TEXT DEFAULT '',
    base_prompt TEXT NOT NULL DEFAULT '',
    negative_prompt TEXT DEFAULT '',
    slot_json TEXT NOT NULL DEFAULT '{}',
    lora TEXT DEFAULT '',
    is_user_template INTEGER NOT NULL DEFAULT 1,
    is_public INTEGER NOT NULL DEFAULT 0,          -- 예전 공개 여부 (더 이상 쓰지 않는다)
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_template_style ON prompt_template_items(style_id, is_public);
CREATE TABLE IF NOT EXISTS prompt_elements (
    id INTEGER PRIMARY KEY,
    element_type TEXT NOT NULL,
    section TEXT NOT NULL DEFAULT '',
    parent_label TEXT,
    label_ko TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    source_id INTEGER,
    created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_elements_lookup ON prompt_elements(element_type, is_active, section, sort_order, id);
CREATE TABLE IF NOT EXISTS prompt_elements_outfit (
    id INTEGER PRIMARY KEY,
    type TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    image_filename TEXT NOT NULL DEFAULT '',
    created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS prompt_famous_places (
    idx INTEGER PRIMARY KEY,
    country_ko TEXT NOT NULL DEFAULT '',
    place_type_ko TEXT NOT NULL DEFAULT '',
    label_ko TEXT NOT NULL DEFAULT '',
    description_ko TEXT,
    prompt TEXT NOT NULL DEFAULT '',
    template_key TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS prompt_famous_place_slots (
    id INTEGER PRIMARY KEY,
    slot_key TEXT NOT NULL,
    label_ko TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS prompt_famous_place_slot_options (
    id INTEGER PRIMARY KEY,
    slot_id INTEGER NOT NULL,
    label_ko TEXT NOT NULL DEFAULT '',
    value_prompt TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS prompt_lora (
    idx INTEGER PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    support_type TEXT NOT NULL DEFAULT '',
    filename TEXT NOT NULL DEFAULT '',
    default_strength REAL NOT NULL DEFAULT 1.0,
    trigger_text TEXT,
    description TEXT,
    url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT
);
-- 템플릿 제작자 표시용 (원본 회원 테이블에서 id·이름만 가져온다. 계정 정보는 가져오지 않는다)
CREATE TABLE IF NOT EXISTS authors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS comfy_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL DEFAULT 'queued',          -- queued / running / completed / failed
    comfyui_url TEXT NOT NULL,
    workflow_id TEXT NOT NULL DEFAULT '',
    workflow_name TEXT NOT NULL DEFAULT '',
    template_id INTEGER,
    template_label TEXT NOT NULL DEFAULT '',
    style_label TEXT NOT NULL DEFAULT '',
    positive_prompt TEXT NOT NULL DEFAULT '',
    negative_prompt TEXT NOT NULL DEFAULT '',
    overrides_json TEXT NOT NULL DEFAULT '{}',
    builder_state_json TEXT NOT NULL DEFAULT '',
    batch_key TEXT NOT NULL DEFAULT '',
    comfyui_prompt_id TEXT,
    seed TEXT,
    images_json TEXT NOT NULL DEFAULT '[]',          -- 로컬에 저장한 결과 파일 (outputs/ 기준 상대경로)
    error_message TEXT,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    started_at TEXT,
    completed_at TEXT,
    failed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON comfy_jobs(status, id);
"""

_local = threading.local()
_init_lock = threading.Lock()
_initialized = False


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(str(paths.DB_PATH), timeout=15, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=OFF")
    return conn


def init_schema(conn: sqlite3.Connection | None = None) -> None:
    c = conn or _connect()
    c.executescript(SCHEMA)
    c.commit()
    if conn is None:
        c.close()


def get() -> sqlite3.Connection:
    """스레드마다 하나의 연결을 쓴다."""
    global _initialized
    if not _initialized:
        with _init_lock:
            if not _initialized:
                paths.ensure_dirs()
                init_schema()
                _initialized = True
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _connect()
        _local.conn = conn
    return conn


def reset_connections() -> None:
    """DB 파일을 통째로 바꾼 뒤 호출 (현재 스레드 연결만 닫힌다; 다른 스레드는 다음 접근 때 새로 연다)."""
    global _initialized
    conn = getattr(_local, "conn", None)
    if conn is not None:
        conn.close()
        _local.conn = None
    _initialized = False


def rows(sql: str, params=()) -> list[dict]:
    return [dict(r) for r in get().execute(sql, params).fetchall()]


def row(sql: str, params=()) -> dict | None:
    r = get().execute(sql, params).fetchone()
    return dict(r) if r else None


def scalar(sql: str, params=(), default=None):
    r = get().execute(sql, params).fetchone()
    return r[0] if r else default


def execute(sql: str, params=()) -> sqlite3.Cursor:
    conn = get()
    cur = conn.execute(sql, params)
    conn.commit()
    return cur


@contextmanager
def transaction():
    conn = get()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
