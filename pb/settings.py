"""앱 설정 (data/settings.json). 로그인이 없으므로 사용자 설정은 이 파일 하나다."""
from __future__ import annotations

import json
import threading

from . import paths

DEFAULTS = {
    "comfy_servers": ["http://127.0.0.1:8188"],  # 최대 3개
    "timeout_minutes": 10,                        # 결과 대기 제한 (1~120)
    "default_workflow_id": "",
    "outfit_model": "coffeemix",                  # 프리셋 미리보기 이미지 모델 (coffeemix / krea)
    "places_model": "coffeemix",
    "dock_open": True,
}

_lock = threading.Lock()
_cache: dict | None = None


def _clean_servers(value) -> list[str]:
    out: list[str] = []
    items = value if isinstance(value, list) else str(value or "").splitlines()
    for line in items:
        url = str(line or "").strip().rstrip("/")
        if not url:
            continue
        if "://" not in url:
            url = "http://" + url
        if url not in out:
            out.append(url)
    return out[:3]


def load() -> dict:
    global _cache
    with _lock:
        if _cache is None:
            data = {}
            try:
                data = json.loads(paths.SETTINGS_PATH.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                data = {}
            merged = dict(DEFAULTS)
            merged.update({k: v for k, v in data.items() if k in DEFAULTS})
            merged["comfy_servers"] = _clean_servers(merged.get("comfy_servers"))
            _cache = merged
        return dict(_cache)


def save(changes: dict) -> dict:
    global _cache
    current = load()
    for k, v in changes.items():
        if k not in DEFAULTS:
            continue
        if k == "comfy_servers":
            v = _clean_servers(v)
        elif k == "timeout_minutes":
            try:
                v = max(1, min(120, int(v)))
            except (TypeError, ValueError):
                v = DEFAULTS["timeout_minutes"]
        elif k in ("outfit_model", "places_model"):
            v = v if v in ("coffeemix", "krea") else "coffeemix"
        elif k == "dock_open":
            v = bool(v)
        else:
            v = str(v or "")
        current[k] = v
    paths.DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = paths.SETTINGS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(paths.SETTINGS_PATH)
    with _lock:
        _cache = dict(current)
    return dict(current)
