"""생성 이미지 썸네일: 갤러리 · 빌더 최근 결과 · 썸네일 줄은 작은 이미지로 빨리 그린다 (크게 볼 때는 원본).

원본(예: 3072×4096 webp)을 그리드마다 디코딩하면 느리다. 썸네일은 outputs/.thumbs/<날짜>/<원본 이름>.webp에
긴 변 THUMB_EDGE로 만든다. 받을 때(comfy._download) 바로 만들고, 없으면 처음 요청할 때 만든다.
이미지 처리는 Qt(QImage)를 쓴다. Qt가 없거나 읽지 못하면 None — 그때는 원본을 보낸다.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

from . import paths

THUMB_EDGE = 800       # 긴 변 (갤러리를 크게 보거나 레티나 화면에서도 흐리지 않게)
QUALITY = 82
FOLDER = ".thumbs"
_gate = threading.BoundedSemaphore(3)  # 큰 원본을 한꺼번에 많이 풀면 메모리를 많이 쓴다


def root() -> Path:
    return paths.OUTPUT_DIR / FOLDER


def _source(rel: str) -> Path | None:
    """outputs 아래 원본 (밖을 가리키거나 썸네일 폴더면 None)."""
    base = paths.OUTPUT_DIR.resolve()
    src = (base / rel).resolve()
    if base not in src.parents or (base / FOLDER) in src.parents or (base / FOLDER) == src:
        return None
    return src


def thumb_path(rel: str) -> Path:
    p = root() / rel
    return p.with_name(p.name + ".webp")


def ensure(rel: str) -> Path | None:
    """썸네일 경로. 없거나 원본보다 오래됐으면 만든다. 만들 수 없으면 None."""
    src = _source(rel)
    if src is None or not src.is_file():
        return None
    dst = thumb_path(rel)
    try:
        if dst.is_file() and dst.stat().st_mtime >= src.stat().st_mtime:
            return dst
    except OSError:
        pass
    with _gate:
        if dst.is_file() and dst.stat().st_mtime >= src.stat().st_mtime:  # 기다리는 동안 다른 요청이 만들었다
            return dst
        return dst if _make(src, dst) else None


def _make(src: Path, dst: Path) -> bool:
    try:
        from PySide6.QtCore import QSize, Qt
        from PySide6.QtGui import QImageIOHandler, QImageReader
    except Exception:  # noqa: BLE001  Qt 없이 서버만 실행할 때
        return False
    reader = QImageReader(str(src))
    reader.setAutoTransform(True)
    size = reader.size()
    w, h = size.width(), size.height()
    if w > 0 and h > 0 and max(w, h) > THUMB_EDGE and reader.supportsOption(QImageIOHandler.ImageOption.ScaledSize):
        k = THUMB_EDGE / max(w, h)
        reader.setScaledSize(QSize(max(1, round(w * k)), max(1, round(h * k))))  # 디코딩할 때 줄인다 (더 빠르다)
    img = reader.read()
    if img.isNull():
        return False
    if max(img.width(), img.height()) > THUMB_EDGE:
        img = img.scaled(THUMB_EDGE, THUMB_EDGE, Qt.AspectRatioMode.KeepAspectRatio,
                         Qt.TransformationMode.SmoothTransformation)
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(f"{dst.name}.{os.getpid()}.{threading.get_ident()}.part")
    try:
        if not img.save(str(tmp), "WEBP", QUALITY) and not img.save(str(tmp), "PNG"):
            return False
        tmp.replace(dst)
        return True
    except OSError:
        return False
    finally:
        tmp.unlink(missing_ok=True)


def remove(rel: str) -> None:
    """원본을 지울 때 썸네일도 지운다 (빈 날짜 폴더도)."""
    if _source(rel) is None:
        return
    dst = thumb_path(rel)
    dst.unlink(missing_ok=True)
    try:
        if dst.parent != root() and not any(dst.parent.iterdir()):
            dst.parent.rmdir()
    except OSError:
        pass
