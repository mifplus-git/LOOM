"""앱 메뉴의 'LOOM 정보' 창 (LUMIQ Studio 정보 창과 같은 구성).
이름 · 제품 설명 · 버전 · 슬로건 · 이름의 뜻(WARP · WEFT) · 소개 · 웹사이트 · 홈페이지 · 블로그 · GitHub."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import QDialog, QFrame, QGridLayout, QLabel, QPushButton, QVBoxLayout

from . import brand
from .icon import draw_icon

# static/css/app.css 의 색과 같다
BG1, BG2, BG3, LINE = "#1b1b1d", "#232326", "#2d2d31", "#2f2f33"
TEXT, TEXT2, TEXT3 = "#ececee", "#a3a3a8", "#6c6c72"
ACCENT, ACCENT_HI, ON_ACCENT = "#f0883e", "#ffa25c", "#1d1206"

STYLE = f"""
QDialog {{ background: {BG1}; }}
QLabel {{ color: {TEXT}; font-size: 13px; }}
QFrame#Card {{ background: {BG2}; border: 1px solid {LINE}; border-radius: 10px; }}
QPushButton {{ background: {BG3}; color: {TEXT}; border: 0; border-radius: 8px; padding: 7px 22px; font-size: 13px; }}
QPushButton#Primary {{ background: {ACCENT}; color: {ON_ACCENT}; font-weight: 600; }}
QPushButton#Primary:hover {{ background: {ACCENT_HI}; }}
"""


def _label(text: str, css: str) -> QLabel:
    lab = QLabel(text)
    lab.setStyleSheet(css)
    return lab


class AboutDialog(QDialog):
    def __init__(self, parent, version: str):
        super().__init__(parent)
        self.setWindowTitle(f"{brand.NAME} 정보")
        self.setStyleSheet(STYLE)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(40, 28, 40, 20)
        lay.setSpacing(4)
        logo = QLabel()
        pm = QPixmap.fromImage(draw_icon(192))
        pm.setDevicePixelRatio(2)
        logo.setPixmap(pm)
        head = [logo,
                _label(brand.NAME, f"font-size: 24px; font-weight: 700; letter-spacing: 3px; margin-top: 8px;"),
                _label(f"{brand.PRODUCT}  ·  버전 {version}", f"color: {TEXT3}; letter-spacing: 0.5px;"),
                _label(brand.SLOGAN, "font-size: 15px; font-weight: 600; margin-top: 16px;"),
                _label(brand.SLOGAN_EN, f"color: {ACCENT_HI}; letter-spacing: 1px;")]
        for w in head:
            lay.addWidget(w, 0, Qt.AlignHCenter)
        lay.addSpacing(16)
        card = QFrame()
        card.setObjectName("Card")
        grid = QGridLayout(card)
        grid.setContentsMargins(18, 12, 18, 12)
        grid.setHorizontalSpacing(14)
        grid.setVerticalSpacing(8)
        for r, (en, ko, meaning) in enumerate(brand.NAME_PARTS):
            grid.addWidget(_label(en, f"font-size: 14px; font-weight: 700; color: {TEXT if r == 0 else ACCENT_HI};"),
                           r, 0, Qt.AlignRight | Qt.AlignVCenter)
            grid.addWidget(_label(ko, f"color: {TEXT3};"), r, 1)
            grid.addWidget(_label(meaning, f"color: {TEXT2};"), r, 2)
        grid.setColumnStretch(2, 1)
        lay.addWidget(card)
        lay.addSpacing(10)
        intro = _label(brand.INTRO, f"color: {TEXT2};")
        intro.setAlignment(Qt.AlignCenter)
        lay.addWidget(intro)
        lay.addSpacing(14)
        links = QGridLayout()
        links.setHorizontalSpacing(12)
        links.setVerticalSpacing(4)
        rows = [(label, f'<a href="{url}" style="color:{ACCENT_HI}; text-decoration:none;">{brand.short_url(url)}</a>')
                for label, url in brand.LINKS] + [("제작자", brand.AUTHOR)]
        for r, (label, value) in enumerate(rows):
            links.addWidget(_label(label, f"color: {TEXT3}; font-size: 12px;"), r, 0, Qt.AlignRight)
            v = _label(value, "font-size: 12px;")
            v.setTextFormat(Qt.RichText)
            v.setOpenExternalLinks(True)
            links.addWidget(v, r, 1)
        lay.addLayout(links)
        lay.setAlignment(links, Qt.AlignHCenter)
        lay.addSpacing(12)
        lay.addWidget(_label(brand.COPYRIGHT, f"color: {TEXT3}; font-size: 11px;"), 0, Qt.AlignHCenter)
        lay.addSpacing(14)
        ok = QPushButton("닫기")
        ok.setObjectName("Primary")
        ok.setDefault(True)
        ok.clicked.connect(self.accept)
        lay.addWidget(ok, 0, Qt.AlignHCenter)
