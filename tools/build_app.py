#!/usr/bin/env python3
"""독립 실행형 'LOOM.app' 만들기 (PyInstaller).

만들어진 앱에는 Python·PySide6(QtWebEngine)·코드·화면 파일이 모두 들어 있어 이 소스 폴더 없이 동작한다.
데이터는 앱 밖의 저장 위치(기본 ~/Documents/LOOM)에 있다.

  .venv/bin/python tools/build_app.py               # build/dist 에 만들고 /Applications 에 설치
  .venv/bin/python tools/build_app.py --no-install  # 만들기만
"""
import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

NAME = "LOOM"
BUNDLE_ID = "local.loom.app"
BUILD = ROOT / "build"


def build_icns(dst: Path):
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    from PySide6.QtGui import QGuiApplication
    from pb.icon import draw_icon
    app = QGuiApplication.instance() or QGuiApplication([])  # noqa: F841
    with tempfile.TemporaryDirectory() as tmp:
        iconset = Path(tmp) / "AppIcon.iconset"
        iconset.mkdir()
        for base in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                px = base * scale
                name = f"icon_{base}x{base}{'@2x' if scale == 2 else ''}.png"
                draw_icon(px).save(str(iconset / name))
        subprocess.run(["iconutil", "-c", "icns", str(iconset), "-o", str(dst)], check=True)


def main():
    if sys.platform != "darwin":
        sys.exit("tools/build_app.py는 macOS 앱(LOOM.app)만 만듭니다. "
                 "Windows는 README의 설치 방법대로 .venv\\Scripts\\pythonw app.py 로 실행하세요.")
    from pb.paths import APP_VERSION as VERSION
    install = "--no-install" not in sys.argv
    BUILD.mkdir(exist_ok=True)
    icns = BUILD / "AppIcon.icns"
    build_icns(icns)
    import PyInstaller.__main__
    PyInstaller.__main__.run([
        str(ROOT / "app.py"),
        "--name", NAME,
        "--windowed",
        "--noconfirm",
        "--clean",
        "--icon", str(icns),
        "--osx-bundle-identifier", BUNDLE_ID,
        "--add-data", f"{ROOT / 'static'}:static",
        "--distpath", str(BUILD / "dist"),
        "--workpath", str(BUILD / "work"),
        "--specpath", str(BUILD),
        "--exclude-module", "tkinter",
        "--exclude-module", "PyInstaller",
    ])
    app = BUILD / "dist" / f"{NAME}.app"
    plist_path = app / "Contents" / "Info.plist"
    with open(plist_path, "rb") as f:
        plist = plistlib.load(f)
    plist.update({
        "CFBundleName": NAME,
        "CFBundleDisplayName": NAME,
        "CFBundleShortVersionString": VERSION,
        "CFBundleVersion": VERSION,
        "LSMinimumSystemVersion": "13.0",
        "NSHighResolutionCapable": True,
        "LSApplicationCategoryType": "public.app-category.graphics-design",
        "NSDocumentsFolderUsageDescription": "템플릿·이미지·생성 결과를 문서 폴더의 저장 위치에 보관합니다.",
        "NSDesktopFolderUsageDescription": "저장 위치를 데스크탑에 둘 때 필요합니다.",
        "NSDownloadsFolderUsageDescription": "이미지를 다운로드 폴더에 저장할 때 필요합니다.",
    })
    with open(plist_path, "wb") as f:
        plistlib.dump(plist, f)
    # Info.plist를 고쳤으니 다시 서명 (ad-hoc)
    subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(app)], check=True)
    size = sum(p.stat().st_size for p in app.rglob("*") if p.is_file() and not p.is_symlink())
    print(f"만들기 완료: {app}  ({size / 1048576:.0f}MB)")
    if install:
        target = Path("/Applications") / f"{NAME}.app"
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(app, target, symlinks=True)
        lsregister = ("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework"
                      "/Support/lsregister")
        if Path(lsregister).exists():
            subprocess.run([lsregister, "-f", str(target)], check=False)
        print(f"설치: {target}")


if __name__ == "__main__":
    main()
