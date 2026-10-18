"""ComfyUI 연동: workflow 파일 관리, 실행용 workflow 조립, 백그라운드 작업 처리기.

웹판은 브라우저가 ComfyUI로 직접 전송했지만, 로컬 앱은 이 모듈의 작업 처리기(스레드)가
대기열(comfy_jobs)을 처리한다. 창을 닫아도 앱이 실행 중이면 생성은 계속된다.
결과 이미지는 ComfyUI에서 받아 data/outputs/날짜/ 에 저장한다.
"""
from __future__ import annotations

import copy
import hashlib
import json
import random
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

from . import db, paths, settings, thumbs

MAX_WORKFLOW_BYTES = 2 * 1024 * 1024
SEED_KEYS = {"seed", "noise_seed", "rand_seed", "random_seed"}
COUNT_KEYS = {"batch_size", "batch", "count", "amount", "num_images", "number_of_images"}


# ---------------------------------------------------------------- workflow 파일

def workflow_id_for(name: str) -> str:
    return "wf_" + hashlib.sha1(name.encode("utf-8")).hexdigest()[:12]


def is_api_format(data) -> bool:
    return (isinstance(data, dict) and bool(data)
            and all(isinstance(v, dict) and "class_type" in v for v in data.values()))


def safe_filename(name: str) -> str:
    base = Path(str(name or "")).name.strip()
    base = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "_", base) or "workflow.json"
    if not base.lower().endswith(".json"):
        base += ".json"
    return base[:120]


def summarize(workflow: dict) -> dict:
    """설정 화면에 보여 줄 요약: 프롬프트가 들어갈 자리, 크기·샘플러, LoRA 노드."""
    raw = json.dumps(workflow, ensure_ascii=False)
    info = {"nodes": len(workflow), "positive": "", "negative": "", "size": "", "sampler": "", "loras": 0,
            "outputs": 0}
    if "{{positive}}" in raw:
        info["positive"] = "{{positive}}"
    if "{{negative}}" in raw:
        info["negative"] = "{{negative}}"
    for nid, node in workflow.items():
        ct = str(node.get("class_type", ""))
        inputs = node.get("inputs") or {}
        title = str((node.get("_meta") or {}).get("title", ""))
        low = ct.lower()
        tl = title.lower()
        if not info["positive"] and ("positive prompt" in tl or "user prompt" in tl):
            info["positive"] = f"#{nid} {title}"
        if not info["negative"] and ("negative prompt" in tl or "neg prompt" in tl) and ct != "CLIPTextEncode":
            info["negative"] = f"#{nid} {title}"
        if ct == "CLIPTextEncode" and isinstance(inputs.get("text"), str):
            neg = _is_negative_clip(node)
            key = "negative" if neg else "positive"
            if not info[key]:
                info[key] = f"#{nid} {title or ct}"
        if _is_latent_node(low) and not info["size"]:
            w, h = inputs.get("width"), inputs.get("height")
            if isinstance(w, (int, float)) and isinstance(h, (int, float)):
                info["size"] = f"{int(w)}×{int(h)}"
        if "sampler" in low and not info["sampler"]:
            st, cfg = inputs.get("steps"), inputs.get("cfg")
            parts = []
            if isinstance(st, (int, float)):
                parts.append(f"{int(st)} steps")
            if isinstance(cfg, (int, float)):
                parts.append(f"cfg {cfg:g}")
            info["sampler"] = " · ".join(parts)
        if "lora" in low:
            info["loras"] += 1
        if "saveimage" in low.replace(" ", "") or "previewimage" in low.replace(" ", ""):
            info["outputs"] += 1
    return info


def read_workflow_file(path: Path) -> dict:
    size = path.stat().st_size
    if size <= 0 or size > MAX_WORKFLOW_BYTES:
        raise ValueError("Workflow JSON 파일은 2MB 이하만 사용할 수 있습니다.")
    raw = path.read_text(encoding="utf-8")
    data = json.loads(raw)
    if not is_api_format(data):
        raise ValueError("API 형식 workflow가 아닙니다.")
    return {
        "id": workflow_id_for(path.name),
        "name": path.stem,
        "file_name": path.name,
        "modified": datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
        "json": raw,
        "data": data,
    }


def list_workflows(include_json: bool = True) -> list[dict]:
    items = []
    paths.WORKFLOW_DIR.mkdir(parents=True, exist_ok=True)
    for f in sorted(paths.WORKFLOW_DIR.glob("*.json"), key=lambda p: p.name.lower()):
        try:
            wf = read_workflow_file(f)
        except (OSError, ValueError):
            continue
        item = {k: wf[k] for k in ("id", "name", "file_name", "modified")}
        if include_json:
            item["json"] = wf["json"]
        item["summary"] = summarize(wf["data"])
        items.append(item)
    return items


def find_workflow(workflow_id: str) -> dict | None:
    for f in paths.WORKFLOW_DIR.glob("*.json"):
        if workflow_id_for(f.name) == workflow_id:
            try:
                return read_workflow_file(f)
            except (OSError, ValueError):
                return None
    return None


def save_workflow(file_name: str, text: str, overwrite: bool = False) -> dict:
    if len(text.encode("utf-8")) > MAX_WORKFLOW_BYTES:
        raise ValueError("Workflow JSON 파일은 2MB 이하만 사용할 수 있습니다.")
    try:
        data = json.loads(text)
    except ValueError:
        raise ValueError("JSON 형식이 올바르지 않습니다.")
    if isinstance(data, dict) and "nodes" in data and "links" in data:
        raise ValueError("화면용(UI) workflow입니다. ComfyUI 메뉴의 'Export (API)'로 저장한 JSON을 올려 주세요.")
    if not is_api_format(data):
        raise ValueError("API 형식 workflow가 아닙니다. ComfyUI의 'Export (API)'로 저장한 JSON을 올려 주세요.")
    name = safe_filename(file_name)
    target = paths.WORKFLOW_DIR / name
    if target.exists() and not overwrite:
        stem, n = target.stem, 2
        while (paths.WORKFLOW_DIR / f"{stem}_{n}.json").exists():
            n += 1
        target = paths.WORKFLOW_DIR / f"{stem}_{n}.json"
    target.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return read_workflow_file(target)


def delete_workflow(workflow_id: str) -> bool:
    wf = find_workflow(workflow_id)
    if not wf:
        return False
    (paths.WORKFLOW_DIR / wf["file_name"]).unlink(missing_ok=True)
    return True


def rename_workflow(workflow_id: str, new_name: str) -> dict:
    wf = find_workflow(workflow_id)
    if not wf:
        raise ValueError("workflow를 찾을 수 없습니다.")
    target = paths.WORKFLOW_DIR / safe_filename(new_name)
    if target.exists() and target.name != wf["file_name"]:
        raise ValueError("같은 이름의 workflow가 있습니다.")
    (paths.WORKFLOW_DIR / wf["file_name"]).rename(target)
    return read_workflow_file(target)


# ---------------------------------------------------------------- 실행용 workflow 조립

def _is_negative_clip(node: dict) -> bool:
    text = str((node.get("inputs") or {}).get("text", "")).lower()
    title = str((node.get("_meta") or {}).get("title", "")).lower()
    return bool(re.search(r"negative|neg|부정|bad|worst|low quality|blurry|deformed|extra fingers|mutated",
                          text + " " + title))


def _is_latent_node(class_lower: str) -> bool:
    return (bool(re.search(r"empty.*latent.*image", class_lower)) or "emptylatent" in class_lower
            or "empty latent" in class_lower or "latent image" in class_lower)


def _replace_placeholders(value, positive: str, negative: str):
    if isinstance(value, str):
        return value.replace("{{positive}}", positive).replace("{{negative}}", negative)
    if isinstance(value, list):
        return [_replace_placeholders(v, positive, negative) for v in value]
    if isinstance(value, dict):
        return {k: _replace_placeholders(v, positive, negative) for k, v in value.items()}
    return value


def _set_prompt_text_nodes(workflow: dict, kind: str, text: str) -> bool:
    """CLIPTextEncode 대신 제목이 'user prompt'/'positive prompt'인 문자열 노드로 연결한 workflow(krea2 계열)."""
    needles = ["negative prompt", "neg prompt", "negative"] if kind == "negative" else ["user prompt", "positive prompt"]
    done = False
    for node in workflow.values():
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        title = str((node.get("_meta") or {}).get("title", "")).lower()
        if not title or not any(n in title for n in needles):
            continue
        for key in ("value", "text", "string"):
            if isinstance(inputs.get(key), str):
                inputs[key] = text
                done = True
                break
    return done


def _set_clip_text(workflow: dict, kind: str, text: str) -> bool:
    target = None
    for key, node in workflow.items():
        if node.get("class_type") != "CLIPTextEncode" or not isinstance((node.get("inputs") or {}).get("text"), str):
            continue
        neg = _is_negative_clip(node)
        if kind == "negative" and neg:
            target = key
            break
        if kind != "negative" and not neg:
            target = key
            break
        if target is None and kind != "negative":
            target = key
    if target is None:
        return False
    workflow[target]["inputs"]["text"] = text
    return True


def apply_prompts(workflow: dict, positive: str, negative: str) -> dict:
    raw = json.dumps(workflow, ensure_ascii=False)
    has_pos = "{{positive}}" in raw
    has_neg = "{{negative}}" in raw
    workflow = _replace_placeholders(workflow, positive, negative)
    if positive and not has_pos:
        if not _set_prompt_text_nodes(workflow, "positive", positive):
            _set_clip_text(workflow, "positive", positive)
    if negative and not has_neg:
        if not _set_prompt_text_nodes(workflow, "negative", negative):
            _set_clip_text(workflow, "negative", negative)
    return workflow


def _num(value, cast, lo, hi):
    try:
        if value is None or value == "":
            return None
        return max(lo, min(hi, cast(value)))
    except (TypeError, ValueError):
        return None


def apply_generation(workflow: dict, gen: dict) -> None:
    width = _num(gen.get("width"), int, 64, 4096)
    height = _num(gen.get("height"), int, 64, 4096)
    cfg = _num(gen.get("cfg"), float, 0.0, 50.0)
    steps = _num(gen.get("steps"), int, 1, 200)
    for node in workflow.values():
        inputs = node.get("inputs")
        if not isinstance(inputs, dict):
            continue
        low = str(node.get("class_type", "")).lower()
        if _is_latent_node(low):
            if width is not None and "width" in inputs:
                inputs["width"] = width
            if height is not None and "height" in inputs:
                inputs["height"] = height
        if "sampler" in low:
            if cfg is not None and "cfg" in inputs:
                inputs["cfg"] = cfg
            if steps is not None and "steps" in inputs:
                inputs["steps"] = steps


def apply_lora_overrides(workflow: dict, overrides: dict) -> None:
    for item in overrides.get("workflow_lora_strengths") or []:
        if not isinstance(item, dict):
            continue
        nid, key = str(item.get("node_id", "")), str(item.get("input_key", ""))
        node = workflow.get(nid)
        if not node or key not in (node.get("inputs") or {}):
            continue
        try:
            strength = max(0.0, min(2.0, float(item.get("strength", 1))))
        except (TypeError, ValueError):
            strength = 1.0
        inputs = node["inputs"]
        value = inputs[key]
        if isinstance(value, dict):
            for k in ("strength", "strengthTwo", "strength_model", "strength_clip"):
                if k in value:
                    value[k] = strength
            continue
        if key.lower() in ("lora_name", "lora") and isinstance(value, str):
            for k in ("strength_model", "strength_clip", "strength"):
                if k in inputs:
                    inputs[k] = strength
            if "strength_model" not in inputs and "strength" not in inputs:
                inputs["strength_model"] = strength
    for item in overrides.get("workflow_lora_enabled") or []:
        if not isinstance(item, dict):
            continue
        nid, key = str(item.get("node_id", "")), str(item.get("input_key", ""))
        node = workflow.get(nid)
        value = (node or {}).get("inputs", {}).get(key) if node else None
        if not isinstance(value, dict):
            continue
        enabled = item.get("enabled", True) is not False
        value["on"] = enabled
        if "enabled" in value:
            value["enabled"] = enabled


def randomize(workflow: dict, image_count: int = 1) -> int:
    seed = random.randint(1, 2**31 - 1)

    def walk(value):
        if isinstance(value, dict):
            for k, v in value.items():
                lk = str(k).lower()
                if lk in SEED_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool):
                    value[k] = seed
                elif lk in COUNT_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool):
                    value[k] = image_count
                else:
                    walk(v)
        elif isinstance(value, list):
            for v in value:
                walk(v)

    walk(workflow)
    return seed


def build_runtime(source: dict, positive: str, negative: str, overrides: dict) -> tuple[dict, int]:
    workflow = copy.deepcopy(source)
    apply_lora_overrides(workflow, overrides or {})
    workflow = apply_prompts(workflow, positive, negative)
    apply_generation(workflow, (overrides or {}).get("generation") or {})
    seed = randomize(workflow, 1)
    return workflow, seed


# ---------------------------------------------------------------- ComfyUI HTTP

class ComfyError(Exception):
    pass


def http_json(method: str, url: str, payload=None, timeout: float = 20):
    body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=body, method=method.upper(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError:
            data = None
        raise ComfyError(compact_error(data, raw.decode("utf-8", "replace"), e.code))
    except (urllib.error.URLError, OSError) as e:
        reason = getattr(e, "reason", e)
        raise ComfyError(f"ComfyUI에 연결할 수 없습니다 ({reason}).")
    try:
        return json.loads(raw.decode("utf-8")) if raw else {}
    except ValueError:
        raise ComfyError("ComfyUI 응답을 해석할 수 없습니다.")


def compact_error(data, text: str, status: int) -> str:
    """/prompt 400 응답(node_errors 포함)을 한 줄로 요약."""
    if isinstance(data, dict):
        parts = []
        err = data.get("error")
        if isinstance(err, dict):
            for k in ("message", "details"):
                v = str(err.get(k) or "").strip()
                if v and v not in parts:
                    parts.append(v)
        elif isinstance(err, str) and err:
            parts.append(err)
        node_errors = data.get("node_errors")
        if isinstance(node_errors, dict) and node_errors:
            labels = []
            for nid, ne in list(node_errors.items())[:3]:
                ct = (ne or {}).get("class_type", "")
                errs = (ne or {}).get("errors") or []
                msg = ""
                if errs and isinstance(errs[0], dict):
                    msg = errs[0].get("details") or errs[0].get("message") or ""
                labels.append(f"#{nid} {ct}: {msg}".strip())
            parts.append(" / ".join(labels))
        if parts:
            return f"HTTP {status} · " + " · ".join(parts)
    return f"HTTP {status} · {text[:200]}"


def ping(url: str) -> dict:
    url = url.rstrip("/")
    started = time.time()
    data = http_json("GET", url + "/system_stats", timeout=5)
    ms = int((time.time() - started) * 1000)
    system = data.get("system") or {}
    devices = data.get("devices") or []
    dev = devices[0] if devices else {}
    vram = dev.get("vram_total")
    return {
        "ok": True,
        "ms": ms,
        "version": system.get("comfyui_version") or "",
        "python": str(system.get("python_version") or "").split(" ")[0],
        "device": dev.get("name") or dev.get("type") or "",
        "vram_gb": round(vram / 1024**3, 1) if isinstance(vram, (int, float)) and vram else None,
    }


def extract_images(history_item: dict | None) -> list[dict]:
    images, seen = [], set()

    def scan(value):
        if isinstance(value, dict):
            if value.get("filename"):
                img = {"filename": str(value["filename"]), "subfolder": str(value.get("subfolder") or ""),
                       "type": str(value.get("type") or "output")}
                key = (img["filename"], img["subfolder"], img["type"])
                if key not in seen:
                    seen.add(key)
                    images.append(img)
            for v in value.values():
                scan(v)
        elif isinstance(value, list):
            for v in value:
                scan(v)

    scan((history_item or {}).get("outputs") or {})
    outputs = [i for i in images if i["type"] == "output"]
    return outputs or images


def history_error(history_item: dict | None) -> str:
    status = (history_item or {}).get("status") or {}
    if status.get("status_str") != "error":
        return ""
    for msg in status.get("messages") or []:
        if isinstance(msg, list) and len(msg) == 2 and msg[0] == "execution_error":
            d = msg[1] or {}
            return f"{d.get('node_type', '')} #{d.get('node_id', '')}: {d.get('exception_message', '').strip()}"
    return "ComfyUI 실행 중 오류가 발생했습니다."


# ---------------------------------------------------------------- 작업(대기열)

def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _parse_time(value) -> float:
    try:
        return datetime.strptime(str(value), "%Y-%m-%d %H:%M:%S").timestamp()
    except (TypeError, ValueError):
        return 0.0


def _public_job(row: dict) -> dict:
    job = dict(row)
    try:
        files = json.loads(job.pop("images_json") or "[]")
    except ValueError:
        files = []
    # thumb: 그리드용 작은 이미지 (크게 볼 때는 url의 원본)
    job["images"] = [{"file": f, "url": "/outputs/" + urllib.parse.quote(f),
                      "thumb": "/thumbs/" + urllib.parse.quote(f)} for f in files]
    job.pop("builder_state_json", None)
    try:
        job["overrides"] = json.loads(job.pop("overrides_json") or "{}")
    except ValueError:
        job["overrides"] = {}
    return job


def jobs_payload(limit: int = 300) -> dict:
    # 생성 중 · 대기 작업은 limit과 상관없이 모두 보낸다 (대기 목록을 빠짐없이 보이고 하나씩 취소할 수 있게)
    rows = db.rows("SELECT * FROM comfy_jobs WHERE status IN ('queued', 'running') "
                   "OR id IN (SELECT id FROM comfy_jobs ORDER BY id DESC LIMIT ?) ORDER BY id DESC", (limit,))
    jobs = [_public_job(r) for r in rows]
    queued_ids = sorted(j["id"] for j in jobs if j["status"] == "queued")
    for j in jobs:
        j["queue_position"] = queued_ids.index(j["id"]) + 1 if j["status"] == "queued" else 0
    counts = {r["status"]: r["n"] for r in db.rows("SELECT status, COUNT(*) AS n FROM comfy_jobs GROUP BY status")}
    return {"ok": True, "jobs": jobs, "counts": counts, "server_time": now()}


def active_count() -> int:
    """생성 중 + 대기 작업 수 (사이드바 갤러리 숫자 · 독 아이콘 배지와 같은 값)."""
    return int(db.scalar("SELECT COUNT(*) FROM comfy_jobs WHERE status IN ('queued', 'running')", default=0) or 0)


def enqueue(data: dict) -> dict:
    servers = settings.load()["comfy_servers"]
    url = str(data.get("comfyui_url") or "").strip().rstrip("/")
    if url not in servers:
        url = servers[0] if servers else ""
    if not url:
        raise ValueError("ComfyUI 서버가 설정되지 않았습니다. ComfyUI 서버 메뉴에서 주소를 먼저 저장하세요.")
    wf = find_workflow(str(data.get("workflow_id") or ""))
    if not wf:
        raise ValueError("선택한 workflow 파일을 찾을 수 없습니다.")
    positive = str(data.get("positive_prompt") or "").strip()
    negative = str(data.get("negative_prompt") or "").strip()
    if not positive:
        raise ValueError("Positive Prompt가 비어 있습니다.")
    overrides = data.get("overrides") if isinstance(data.get("overrides"), dict) else {}
    build_runtime(wf["data"], positive, negative, overrides)  # 조립 가능 여부를 미리 확인
    try:
        count = max(1, min(20, int(data.get("image_count") or 1)))
    except (TypeError, ValueError):
        count = 1
    template_id = data.get("template_id")
    try:
        template_id = int(template_id) if template_id not in (None, "") else None
    except (TypeError, ValueError):
        template_id = None
    batch = hashlib.sha1(f"{time.time()}-{random.random()}".encode()).hexdigest()[:12]
    state = data.get("builder_state")
    state_json = json.dumps(state, ensure_ascii=False) if isinstance(state, dict) else ""
    with db.transaction() as conn:
        for _ in range(count):
            conn.execute(
                "INSERT INTO comfy_jobs (status, comfyui_url, workflow_id, workflow_name, template_id, template_label,"
                " style_label, positive_prompt, negative_prompt, overrides_json, builder_state_json, batch_key, created_at)"
                " VALUES ('queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (url, wf["id"], wf["name"], template_id, str(data.get("template_label") or "")[:200],
                 str(data.get("style_label") or "")[:200], positive, negative,
                 json.dumps(overrides, ensure_ascii=False), state_json, batch, now()))
    worker.wake()
    return jobs_payload()


def regenerate(job_id: int, count: int = 1) -> dict:
    src = db.row("SELECT * FROM comfy_jobs WHERE id = ?", (job_id,))
    if not src:
        raise ValueError("작업을 찾을 수 없습니다.")
    count = max(1, min(20, int(count or 1)))
    with db.transaction() as conn:
        for _ in range(count):
            conn.execute(
                "INSERT INTO comfy_jobs (status, comfyui_url, workflow_id, workflow_name, template_id, template_label,"
                " style_label, positive_prompt, negative_prompt, overrides_json, builder_state_json, batch_key, created_at)"
                " VALUES ('queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (src["comfyui_url"], src["workflow_id"], src["workflow_name"], src["template_id"], src["template_label"],
                 src["style_label"], src["positive_prompt"], src["negative_prompt"], src["overrides_json"],
                 src["builder_state_json"], src["batch_key"], now()))
    worker.wake()
    return jobs_payload()


def cancel(job_id: int) -> dict:
    """대기 작업 취소 또는 실행 중 작업 중단(ComfyUI interrupt)."""
    job = db.row("SELECT * FROM comfy_jobs WHERE id = ?", (job_id,))
    if not job:
        return jobs_payload()
    if job["status"] == "running":
        url = job["comfyui_url"].rstrip("/")
        pid = job.get("comfyui_prompt_id")
        try:
            if pid:
                # 아직 ComfyUI 대기열에 있으면 거기서 지우고, 실행 중이면 중단한다
                http_json("POST", url + "/queue", {"delete": [pid]}, timeout=5)
            http_json("POST", url + "/interrupt", {}, timeout=5)
        except ComfyError:
            pass
    if job["status"] in ("queued", "running"):
        db.execute("DELETE FROM comfy_jobs WHERE id = ? AND status IN ('queued','running')", (job_id,))
    worker.wake()
    return jobs_payload()


def cancel_all() -> dict:
    for j in db.rows("SELECT id FROM comfy_jobs WHERE status = 'running'"):
        cancel(j["id"])
    db.execute("DELETE FROM comfy_jobs WHERE status = 'queued'")
    return jobs_payload()


def delete_jobs(ids: list[int], remove_files: bool = True) -> dict:
    ids = [int(i) for i in ids if str(i).isdigit()]
    if not ids:
        return jobs_payload()
    ph = ",".join("?" for _ in ids)
    rows = db.rows(f"SELECT id, images_json FROM comfy_jobs WHERE id IN ({ph}) AND status IN ('completed','failed')", ids)
    if remove_files:
        for r in rows:
            try:
                for f in json.loads(r["images_json"] or "[]"):
                    p = (paths.OUTPUT_DIR / f).resolve()
                    if paths.OUTPUT_DIR.resolve() in p.parents:
                        p.unlink(missing_ok=True)
                        thumbs.remove(f)
            except ValueError:
                pass
    db.execute(f"DELETE FROM comfy_jobs WHERE id IN ({ph}) AND status IN ('completed','failed')", ids)
    return jobs_payload()


def clear_failed() -> dict:
    db.execute("DELETE FROM comfy_jobs WHERE status = 'failed'")
    return jobs_payload()


def job_state(job_id: int) -> dict | None:
    r = db.row("SELECT builder_state_json FROM comfy_jobs WHERE id = ?", (job_id,))
    if not r or not r["builder_state_json"]:
        return None
    try:
        return json.loads(r["builder_state_json"])
    except ValueError:
        return None


# ---------------------------------------------------------------- 작업 처리기

class Worker(threading.Thread):
    """서버마다 한 번에 하나씩: 대기 작업 → /prompt 전송 → /history 확인 → 이미지 저장."""

    def __init__(self):
        super().__init__(name="comfy-worker", daemon=True)
        self._wake = threading.Event()
        self._stop = threading.Event()
        self.last_error: dict[str, str] = {}

    def wake(self):
        self._wake.set()

    def stop(self):
        self._stop.set()
        self._wake.set()

    def run(self):
        # 앱이 꺼진 사이 '실행 중'으로 남은 작업은 ComfyUI 기록을 다시 확인한다 (prompt_id가 없으면 대기로 되돌림)
        try:
            db.execute("UPDATE comfy_jobs SET status='queued', started_at=NULL WHERE status='running' "
                       "AND (comfyui_prompt_id IS NULL OR comfyui_prompt_id = '')")
        except Exception:
            pass
        while not self._stop.is_set():
            busy = False
            try:
                busy = self.tick()
            except Exception as e:  # 처리기가 죽지 않게
                self.last_error["_"] = str(e)
            self._wake.wait(1.2 if busy else 3.0)
            self._wake.clear()

    def tick(self) -> bool:
        busy = False
        running = db.rows("SELECT * FROM comfy_jobs WHERE status = 'running' ORDER BY id")
        busy_urls = set()
        for job in running:
            busy = True
            busy_urls.add(job["comfyui_url"])
            self._poll(job)
        queued = db.rows("SELECT * FROM comfy_jobs WHERE status = 'queued' ORDER BY id")
        for job in queued:
            busy = True
            if job["comfyui_url"] in busy_urls:
                continue
            busy_urls.add(job["comfyui_url"])
            self._dispatch(job)
        return busy

    def _fail(self, job_id: int, message: str):
        db.execute("UPDATE comfy_jobs SET status='failed', failed_at=?, error_message=? WHERE id=?",
                   (now(), message[:1000], job_id))

    def _dispatch(self, job: dict):
        cur = db.execute("UPDATE comfy_jobs SET status='running', started_at=?, error_message=NULL "
                         "WHERE id=? AND status='queued'", (now(), job["id"]))
        if cur.rowcount != 1:
            return
        wf = find_workflow(job["workflow_id"])
        if not wf:
            self._fail(job["id"], "workflow 파일을 찾을 수 없습니다 (삭제되었거나 이름이 바뀜).")
            return
        try:
            overrides = json.loads(job["overrides_json"] or "{}")
        except ValueError:
            overrides = {}
        try:
            workflow, seed = build_runtime(wf["data"], job["positive_prompt"], job["negative_prompt"], overrides)
        except Exception as e:
            self._fail(job["id"], f"workflow 조립 실패: {e}")
            return
        url = job["comfyui_url"].rstrip("/")
        try:
            data = http_json("POST", url + "/prompt", {"prompt": workflow, "client_id": "loom-local"},
                             timeout=30)
        except ComfyError as e:
            msg = str(e)
            if "연결할 수 없습니다" in msg:
                # 서버가 꺼져 있으면 실패 처리하지 않고 대기로 되돌린 뒤 잠시 쉰다
                db.execute("UPDATE comfy_jobs SET status='queued', started_at=NULL, error_message=? WHERE id=?",
                           (msg, job["id"]))
                self.last_error[url] = msg
                time.sleep(2)
                return
            self._fail(job["id"], "ComfyUI 전송 실패: " + msg)
            return
        self.last_error.pop(url, None)
        pid = str(data.get("prompt_id") or "")
        if not pid:
            self._fail(job["id"], "ComfyUI prompt_id를 받지 못했습니다.")
            return
        db.execute("UPDATE comfy_jobs SET comfyui_prompt_id=?, seed=? WHERE id=? AND status='running'",
                   (pid, str(seed), job["id"]))

    def _poll(self, job: dict):
        url = job["comfyui_url"].rstrip("/")
        pid = job.get("comfyui_prompt_id") or ""
        started = _parse_time(job.get("started_at")) or time.time()
        timeout_s = settings.load()["timeout_minutes"] * 60
        if not pid:
            if time.time() - started > 120:
                self._fail(job["id"], "ComfyUI prompt_id를 받지 못했습니다.")
            return
        try:
            history = http_json("GET", url + "/history/" + urllib.parse.quote(pid), timeout=15)
        except ComfyError as e:
            self.last_error[url] = str(e)
            if time.time() - started > timeout_s:
                self._fail(job["id"], "ComfyUI 기록 조회 실패: " + str(e))
            return
        self.last_error.pop(url, None)
        item = history.get(pid) if isinstance(history, dict) else None
        err = history_error(item)
        if err:
            self._fail(job["id"], err)
            return
        images = extract_images(item)
        completed = bool(((item or {}).get("status") or {}).get("completed"))
        if images and (completed or item.get("outputs")):
            try:
                files = self._download(job, url, images)
            except ComfyError as e:
                self._fail(job["id"], "결과 이미지 저장 실패: " + str(e))
                return
            db.execute("UPDATE comfy_jobs SET status='completed', completed_at=?, images_json=?, error_message=NULL "
                       "WHERE id=? AND status='running'", (now(), json.dumps(files, ensure_ascii=False), job["id"]))
            return
        if item and completed and not images:
            self._fail(job["id"], "결과 이미지가 없습니다. workflow에 이미지 저장 노드가 있는지 확인하세요.")
            return
        if time.time() - started > timeout_s:
            self._fail(job["id"], f"{timeout_s // 60}분 안에 결과 이미지를 받지 못했습니다.")

    def _download(self, job: dict, url: str, images: list[dict]) -> list[str]:
        day = datetime.now().strftime("%Y-%m-%d")
        folder = paths.OUTPUT_DIR / day
        folder.mkdir(parents=True, exist_ok=True)
        files = []
        for i, img in enumerate(images, 1):
            q = urllib.parse.urlencode({"filename": img["filename"], "subfolder": img["subfolder"], "type": img["type"]})
            try:
                with urllib.request.urlopen(url + "/view?" + q, timeout=60) as res:
                    blob = res.read()
            except (urllib.error.URLError, OSError) as e:
                raise ComfyError(str(getattr(e, "reason", e)))
            ext = Path(img["filename"]).suffix.lower() or ".png"
            name = f"pb_{job['id']:06d}_{i}{ext}"
            (folder / name).write_bytes(blob)
            files.append(f"{day}/{name}")
            try:
                thumbs.ensure(f"{day}/{name}")  # 갤러리가 바로 작은 이미지로 그리게
            except Exception:  # noqa: BLE001  썸네일이 없어도 갤러리는 원본으로 그린다
                pass
        return files


worker = Worker()

_ping_cache: dict[str, dict] = {}
_ping_lock = threading.Lock()
_ping_running = False


def _refresh_pings(urls: list[str]) -> None:
    global _ping_running
    try:
        for url in urls:
            try:
                info = ping(url)
            except ComfyError as e:
                info = {"ok": False, "message": str(e)}
            info["checked"] = time.time()
            with _ping_lock:
                _ping_cache[url] = info
    finally:
        _ping_running = False


def server_status() -> dict:
    """설정된 서버들의 연결 상태 (10초마다 백그라운드에서 다시 확인)."""
    global _ping_running
    urls = settings.load()["comfy_servers"]
    with _ping_lock:
        stale = [u for u in urls if time.time() - _ping_cache.get(u, {}).get("checked", 0) > 10]
        if stale and not _ping_running:
            _ping_running = True
            threading.Thread(target=_refresh_pings, args=(stale,), daemon=True).start()
        servers = [{"url": u, **_ping_cache.get(u, {"ok": None})} for u in urls]
    return {"servers": servers, "errors": dict(worker.last_error)}
