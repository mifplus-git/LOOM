"""앱 아이콘 (LM 글자). LUMIQ의 LQ 아이콘과 같은 방식: 어두운 둥근 사각형 + 흰 L + 앰버 M.
실행 중 Dock 아이콘, .app 번들 아이콘, 웹 화면 파비콘에 같이 쓴다."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QColor, QFont, QFontMetricsF, QImage, QLinearGradient, QPainter, QPainterPath


def draw_icon(size: int = 1024) -> QImage:
    img = QImage(size, size, QImage.Format_ARGB32)
    img.fill(Qt.transparent)
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    s = size / 1024
    # macOS 아이콘 격자: 824px 둥근 사각형
    body = QRectF(100 * s, 100 * s, 824 * s, 824 * s)
    bg = QLinearGradient(body.topLeft(), body.bottomLeft())
    bg.setColorAt(0, QColor("#2a2a2e"))
    bg.setColorAt(1, QColor("#121214"))
    p.setPen(Qt.NoPen)
    p.setBrush(bg)
    p.drawRoundedRect(body, 185 * s, 185 * s)
    # LOOM의 처음(L)은 흰색, 끝(M)은 앱 강조색 그라데이션
    f = QFont()
    f.setFamilies(["Avenir Next", "Segoe UI", "Helvetica Neue", "Arial"])  # macOS · Windows
    f.setWeight(QFont.DemiBold)
    f.setPixelSize(max(int(400 * s), 1))
    l_path, m_path = QPainterPath(), QPainterPath()
    l_path.addText(0, 0, f, "L")
    m_path.addText(QFontMetricsF(f).horizontalAdvance("L") - 4 * s, 0, f, "M")
    br = l_path.united(m_path).boundingRect()
    dx, dy = body.center().x() - br.center().x(), body.center().y() - br.center().y()
    l_path.translate(dx, dy)
    m_path.translate(dx, dy)
    p.setBrush(QColor("#f5f5f7"))
    p.drawPath(l_path)
    bb = m_path.boundingRect()
    amber = QLinearGradient(bb.topLeft(), bb.bottomRight())
    amber.setColorAt(0, QColor("#ffc070"))
    amber.setColorAt(1, QColor("#f0883e"))
    p.setBrush(amber)
    p.drawPath(m_path)
    p.end()
    return img


def write_pngs(folder: Path) -> None:
    """웹 화면용 파비콘 PNG."""
    folder.mkdir(parents=True, exist_ok=True)
    for px in (64, 256, 512):
        draw_icon(px).save(str(folder / f"icon-{px}.png"))


if __name__ == "__main__":
    import sys

    from PySide6.QtGui import QGuiApplication

    app = QGuiApplication(sys.argv)
    from . import paths
    write_pngs(paths.STATIC_DIR / "img")
    print("ok")
