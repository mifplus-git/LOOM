"""데이터 저장 위치 관리.

앱 설정 폴더(paths.CONFIG_DIR)의 storage.json 에 현재 위치를 적어 둔다.
위치를 바꾸면 '이동 예약'만 해 두고, 앱을 다시 시작할 때(DB를 열기 전에) 옮긴다.
처음 실행할 때 예전 위치에 데이터가 있으면 새 위치로 자동으로 옮긴다.
이름을 바꾸기 전(Prompt Builder)의 앱 설정 · 기록 · 기본 저장 위치도 처음 한 번 새 이름으로 옮긴다.
"""
from __future__ import annotations

import json
import os
import shutil
from datetime import datetime
from pathlib import Path

from . import native, paths

CONFIG_PATH = paths.CONFIG_DIR / "storage.json"
# 예전 버전이 데이터를 두던 곳 (발견하면 저장 위치로 옮긴다)
LEGACY_DIRS = [paths.HOME / "Documents" / "Projects" / "prompt" / "app" / "data"]
SKIP = {"webview", ".DS_Store"}
OVERRIDE = False  # --data-dir 점검 실행이면 True: 저장 위치 설정을 바꾸지 않는다


def load_cfg() -> dict:
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_cfg(cfg: dict) -> None:
    paths.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = CONFIG_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(CONFIG_PATH)


def has_data(d) -> bool:
    return bool(d) and (Path(d) / paths.DB_NAME).is_file()


def same(a, b) -> bool:
    try:
        return Path(a).expanduser().resolve() == Path(b).expanduser().resolve()
    except OSError:
        return False


def inside(child, parent) -> bool:
    try:
        c, p = Path(child).expanduser().resolve(), Path(parent).expanduser().resolve()
        return c != p and p in c.parents
    except OSError:
        return False


def folder_size(d) -> int:
    total = 0
    for root, _dirs, files in os.walk(d):
        for f in files:
            try:
                total += os.lstat(os.path.join(root, f)).st_size
            except OSError:
                pass
    return total


def _move(src: Path, dst: Path) -> None:
    if dst.exists():
        if src.is_dir() and dst.is_dir():
            for child in list(src.iterdir()):
                _move(child, dst / child.name)
            try:
                src.rmdir()
            except OSError:
                pass
            return
        if dst.is_dir():
            shutil.rmtree(dst)
        else:
            dst.unlink()
    shutil.move(str(src), str(dst))


def move_data(src, dst, log=print) -> None:
    """src 폴더의 데이터를 dst로 옮긴다 (같은 디스크면 이름만 바뀌어 즉시 끝난다)."""
    src, dst = Path(src).expanduser(), Path(dst).expanduser()
    dst.mkdir(parents=True, exist_ok=True)
    log(f"데이터 이동: {src} → {dst}")
    for child in list(src.iterdir()):
        if child.name in SKIP:
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)
            else:
                child.unlink(missing_ok=True)
            continue
        _move(child, dst / child.name)
    try:
        src.rmdir()
    except OSError:
        pass


def legacy_running() -> bool:
    """이름을 바꾸기 전 앱(Prompt Builder)이 켜져 있는지: 그 앱의 실행 잠금을 잡아 본다."""
    lock = paths.LEGACY_CONFIG_DIR / "instance.lock"
    if not lock.is_file():
        return False
    try:
        with open(lock, "a") as f:
            if not native.try_lock(f):
                return True
            native.unlock(f)
        return False
    except OSError:
        return True


def migrate_legacy() -> list[str]:
    """처음 한 번: 예전 이름의 앱 설정 폴더(저장 위치 기록 · 창 저장소)와 기록 파일을 새 이름으로 옮긴다.
    예전 기본 저장 위치 폴더는 resolve()가 옮긴다. 기록을 열기 전에 부르므로 한 일을 돌려준다."""
    done = []
    for old, new in ((paths.LEGACY_CONFIG_DIR, paths.CONFIG_DIR), (paths.LEGACY_LOG_PATH, paths.LOG_PATH)):
        if old.exists() and not new.exists():
            try:
                new.parent.mkdir(parents=True, exist_ok=True)
                old.rename(new)
                done.append(f"이름 변경: {old} → {new}")
            except OSError as e:
                done.append(f"옮기지 못함: {old} ({e})")
    return done


def current_dir(cfg: dict | None = None) -> Path:
    cfg = cfg if cfg is not None else load_cfg()
    return Path(cfg.get("data_dir") or paths.DEFAULT_DATA_DIR).expanduser()


def resolve(log=print) -> Path:
    """실행 초기에 한 번: 예약된 이동을 처리하고, 예전 데이터를 옮기고, 경로를 정한다."""
    cfg = load_cfg()
    current = current_dir(cfg)
    pending = cfg.pop("pending", None)
    if pending:
        src = Path(pending.get("from") or current).expanduser()
        dst = Path(pending.get("to") or "").expanduser()
        try:
            if not str(pending.get("to") or ""):
                raise RuntimeError("이동할 위치가 비어 있습니다.")
            if pending.get("mode") == "move" and has_data(src) and not same(src, dst):
                if has_data(dst):
                    raise RuntimeError(f"{dst}에 이미 데이터가 있어 옮기지 않았습니다.")
                move_data(src, dst, log)
            current = dst
            cfg["last_move"] = {"from": str(src), "to": str(dst), "mode": pending.get("mode"),
                                "at": datetime.now().strftime("%Y-%m-%d %H:%M")}
            cfg.pop("last_error", None)
        except Exception as e:  # noqa: BLE001  옮기지 못하면 원래 위치를 그대로 쓴다
            cfg["last_error"] = f"데이터를 옮기지 못했습니다: {e}"
            log(cfg["last_error"])
    # 예전 이름의 기본 저장 위치(~/Documents/Prompt Builder)를 쓰고 있었으면 새 이름(~/Documents/LOOM)으로 바꾼다
    if same(current, paths.LEGACY_DATA_DIR) and has_data(current) and not paths.DEFAULT_DATA_DIR.exists():
        try:
            current.rename(paths.DEFAULT_DATA_DIR)
            log(f"저장 위치 이름 변경: {current} → {paths.DEFAULT_DATA_DIR}")
            cfg["renamed_from"] = str(current)
            current = paths.DEFAULT_DATA_DIR
        except OSError as e:  # 바꾸지 못하면 예전 폴더를 그대로 쓴다
            cfg["last_error"] = f"저장 위치 폴더 이름을 바꾸지 못했습니다: {e}"
            log(cfg["last_error"])
    if not has_data(current):
        for legacy in LEGACY_DIRS:
            if has_data(legacy) and not same(legacy, current):
                try:
                    move_data(legacy, current, log)
                    cfg["migrated_from"] = str(legacy)
                except Exception as e:  # noqa: BLE001
                    cfg["last_error"] = f"예전 데이터를 옮기지 못했습니다: {e}"
                    log(cfg["last_error"])
                break
    cfg["data_dir"] = str(current)
    save_cfg(cfg)
    paths.configure(current)
    return current


def info() -> dict:
    cfg = load_cfg()
    cur = paths.DATA_DIR
    return {
        "data_dir": str(cur),
        "default_dir": str(paths.DEFAULT_DATA_DIR),
        "is_default": same(cur, paths.DEFAULT_DATA_DIR),
        "size": folder_size(cur) if cur.exists() else 0,
        "pending": cfg.get("pending"),
        "last_error": cfg.get("last_error", ""),
        "last_move": cfg.get("last_move"),
        "migrated_from": cfg.get("migrated_from", ""),
        "config_path": str(CONFIG_PATH),
    }


def request_change(path: str, mode: str = "move") -> dict:
    """새 위치를 예약한다. 반환: {target, conflict, size}. 실제 이동은 다시 시작할 때."""
    if OVERRIDE:
        raise ValueError("점검용(--data-dir) 실행에서는 저장 위치를 바꿀 수 없습니다.")
    raw = str(path or "").strip()
    if not raw:
        raise ValueError("위치를 고르세요.")
    target = Path(raw).expanduser()
    if not target.is_absolute():
        raise ValueError(f"전체 경로를 입력하세요 (예: {paths.DEFAULT_DATA_DIR}).")
    cur = paths.DATA_DIR
    # 비어 있지 않은 일반 폴더를 고르면 그 안에 'LOOM' 폴더를 만든다
    if target.exists() and not has_data(target) and any(p for p in target.iterdir() if p.name not in SKIP) \
            and target.name != paths.APP_NAME:
        target = target / paths.APP_NAME
    if same(target, cur):
        raise ValueError("지금 쓰는 위치와 같습니다.")
    if inside(target, cur):
        raise ValueError("지금 데이터 폴더 안으로는 옮길 수 없습니다.")
    if inside(cur, target):
        raise ValueError("지금 데이터 폴더를 품은 상위 폴더로는 옮길 수 없습니다. 다른 폴더를 고르세요.")
    if has_data(target) and mode != "use":
        return {"target": str(target), "conflict": True}
    probe_parent = target if target.exists() else target.parent
    while not probe_parent.exists() and probe_parent != probe_parent.parent:
        probe_parent = probe_parent.parent
    if not os.access(probe_parent, os.W_OK):
        raise ValueError(f"쓸 수 없는 위치입니다: {probe_parent}")
    size = folder_size(cur) if mode == "move" else 0
    if mode == "move":
        try:
            if os.stat(probe_parent).st_dev != os.stat(cur).st_dev and shutil.disk_usage(probe_parent).free < size * 1.05:
                raise ValueError("새 위치의 디스크 공간이 부족합니다.")
        except OSError:
            pass
    cfg = load_cfg()
    cfg["pending"] = {"from": str(cur), "to": str(target), "mode": "use" if mode == "use" else "move",
                      "at": datetime.now().strftime("%Y-%m-%d %H:%M")}
    save_cfg(cfg)
    return {"target": str(target), "conflict": False, "size": size, "mode": cfg["pending"]["mode"]}


def cancel_change() -> None:
    cfg = load_cfg()
    cfg.pop("pending", None)
    save_cfg(cfg)


def clear_error() -> None:
    cfg = load_cfg()
    cfg.pop("last_error", None)
    save_cfg(cfg)
