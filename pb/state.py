"""빌더 작업 상태(선택값 스냅샷) 저장. 웹판의 localStorage('builderWorkState')를 파일로 옮겼다."""
from __future__ import annotations

import json

from . import paths


def load() -> dict | None:
    try:
        data = json.loads(paths.STATE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def save(state) -> None:
    if not isinstance(state, dict):
        paths.STATE_PATH.unlink(missing_ok=True)
        return
    tmp = paths.STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    tmp.replace(paths.STATE_PATH)
