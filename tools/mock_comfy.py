#!/usr/bin/env python3
"""개발용 가짜 ComfyUI 서버: /prompt · /history · /view · /system_stats · /interrupt · /queue.
생성 대신 프롬프트 글자가 들어간 단색 PNG를 몇 초 뒤 결과로 돌려준다.

  .venv/bin/python tools/mock_comfy.py [port=8188] [delay=4]
"""
import json
import struct
import sys
import threading
import time
import uuid
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8188
DELAY = float(sys.argv[2]) if len(sys.argv) > 2 else 4
jobs = {}
images = {}


def png(w, h, rgb):
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, data, ctype="application/json", status=200):
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlsplit(self.path)
        if u.path == "/system_stats":
            return self.send({"system": {"comfyui_version": "mock", "python_version": "3.12"}, "devices": [{"name": "Mock GPU", "vram_total": 8 * 1024**3}]})
        if u.path.startswith("/history/"):
            pid = u.path.split("/")[-1]
            j = jobs.get(pid)
            if not j or time.time() - j["t"] < DELAY:
                return self.send({})
            if j.get("error"):
                return self.send({pid: {"outputs": {}, "status": {"status_str": "error", "completed": False, "messages": [["execution_error", {"node_type": "KSampler", "node_id": "5", "exception_message": "mock error"}]]}}})
            return self.send({pid: {"outputs": {"9": {"images": [{"filename": j["file"], "subfolder": "", "type": "output"}]}}, "status": {"status_str": "success", "completed": True}}})
        if u.path == "/view":
            q = parse_qs(u.query)
            return self.send(images.get(q.get("filename", [""])[0], b""), "image/png")
        self.send({"error": "not found"}, status=404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        data = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/prompt":
            wf = data.get("prompt") or {}
            text = json.dumps(wf)
            pid = str(uuid.uuid4())
            seed = abs(hash(text)) % 255
            w = h = 0
            for node in wf.values():
                inp = node.get("inputs", {})
                if isinstance(inp.get("width"), int):
                    w, h = inp["width"], inp["height"]
            w, h = max(64, min(w or 512, 640)) // 4, max(64, min(h or 512, 640)) // 4
            fname = f"mock_{pid[:8]}.png"
            images[fname] = png(w, h, ((seed * 7) % 255, (seed * 13) % 255, (seed * 29) % 255))
            jobs[pid] = {"t": time.time(), "file": fname, "error": "FAIL_ME" in text}
            print("prompt", pid, w * 4, "x", h * 4, flush=True)
            return self.send({"prompt_id": pid, "number": len(jobs), "node_errors": {}})
        if self.path in ("/interrupt", "/queue"):
            return self.send({})
        self.send({"error": "not found"}, status=404)


ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
