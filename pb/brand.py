"""브랜드 (LOOM — Brand Identity 1.0, 2026-10-15).

앱 메뉴(도움말 · LOOM 정보), 정보 창, 설정 › 정보가 모두 이 값을 쓴다.
표기 원칙: 브랜드는 항상 LOOM(대문자). 'Prompt Builder'는 제품 설명 문구이고 브랜드명의 일부가 아니다.
"""
from __future__ import annotations

NAME = "LOOM"
PRODUCT = "Prompt Builder for ComfyUI"
SLOGAN = "단어를 엮어, 이미지를 짓다."
SLOGAN_EN = "Weave the Words. Build the Image."
# 이름의 뜻: 베틀이 날실과 씨실을 엮어 천 한 장을 짜내듯
NAME_PARTS = [("WARP", "날실", "구조와 템플릿 — 프롬프트의 뼈대"),
              ("WEFT", "씨실", "요소와 표현 — 주제 · 스타일 · 조명 · 분위기")]
INTRO = ("템플릿이라는 구조 위에 주제 · 스타일 · 조명 · 구도 같은 요소를 엮어\n"
         "완성도 높은 프롬프트를 짜내고, ComfyUI로 바로 생성합니다.")
AUTHOR = "mif"
COPYRIGHT = "© 2026 mif. All rights reserved."
# (이름, 주소): 도움말 메뉴와 정보 창 · 설정 › 정보에 이 순서로 나온다
LINKS = [("웹사이트", "https://prompt.mifplus.com"),
         ("홈페이지", "https://crm.mifplus.com"),
         ("블로그", "https://mifplus.com"),
         ("GitHub", "https://github.com/mifplus-git/LOOM")]


def short_url(url: str) -> str:
    return url.removeprefix("https://").removeprefix("http://")


def boot() -> dict:
    """설정 › 정보 화면용."""
    return {"name": NAME, "product": PRODUCT, "slogan": SLOGAN, "sloganEn": SLOGAN_EN,
            "parts": [{"en": en, "ko": ko, "text": t} for en, ko, t in NAME_PARTS], "intro": INTRO,
            "author": AUTHOR, "copyright": COPYRIGHT,
            "links": [{"label": l, "url": u, "short": short_url(u)} for l, u in LINKS]}
