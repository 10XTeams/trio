"""Trio skill HTTP server — stdlib only."""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

NOTE_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")

VERSION = "1.6.0"
WEB_ROOT = Path(__file__).parent / "web"


def make_handler(cwd_real: str):
    def safe_resolve(rel_path: str) -> str | None:
        """Resolve rel_path under cwd_real; return absolute path or None if it escapes.

        Leading slashes in rel_path are stripped before joining, so absolute-looking
        paths (e.g. "/etc/passwd") are silently reinterpreted as relative to cwd_real
        (becomes cwd_real/etc/passwd). realpath then resolves symlinks, and the final
        path must still live under cwd_real or the call returns None.
        """
        candidate = os.path.realpath(os.path.join(cwd_real, rel_path.lstrip("/")))
        if candidate != cwd_real and not candidate.startswith(cwd_real + os.sep):
            return None
        return candidate

    notes_dir = os.path.join(cwd_real, "trio", "notes")

    def notes_path(note_id: str) -> str:
        return os.path.join(notes_dir, note_id + ".json")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            # Quiet default logging — nohup captures stderr separately.
            pass

        def _send_json(self, status: int, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def serve_static(self, rel: str):
            if rel in ("", "/"):
                rel = "index.html"
            rel = rel.lstrip("/")
            candidate = os.path.realpath(os.path.join(WEB_ROOT, rel))
            web_root_real = os.path.realpath(WEB_ROOT)
            if not (candidate == web_root_real or candidate.startswith(web_root_real + os.sep)):
                return self._send_json(403, {"error": "path escape"})
            if not os.path.isfile(candidate):
                return self._send_json(404, {"error": "not found"})
            ctype, _ = mimetypes.guess_type(candidate)
            with open(candidate, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype or "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == "/api/meta":
                return self._send_json(200, {"cwd": cwd_real, "version": VERSION})
            if parsed.path == "/api/tree":
                params = parse_qs(parsed.query)
                rel = (params.get("path", ["/"])[0] or "/").lstrip("/")
                abs_dir = safe_resolve(rel)
                if abs_dir is None:
                    return self._send_json(403, {"error": "path escape"})
                if not os.path.isdir(abs_dir):
                    return self._send_json(404, {"error": "not a directory"})
                entries = []
                for name in sorted(os.listdir(abs_dir)):
                    full = os.path.join(abs_dir, name)
                    if os.path.isdir(full):
                        entries.append({"name": name, "type": "dir"})
                    elif os.path.isfile(full) and (name.lower().endswith(".md") or name.lower().endswith(".json")):
                        st = os.stat(full)
                        # mtime is a stringified int64 so JS float64 parsing cannot
                        # truncate the nanosecond precision that If-Match depends on.
                        entries.append({"name": name, "type": "file", "size": st.st_size, "mtime": str(st.st_mtime_ns)})
                return self._send_json(200, {"entries": entries})
            if parsed.path == "/api/file":
                params = parse_qs(parsed.query)
                rel = params.get("path", [""])[0]
                abs_file = safe_resolve(rel)
                if abs_file is None:
                    return self._send_json(403, {"error": "path escape"})
                if not os.path.isfile(abs_file):
                    return self._send_json(404, {"error": "not a file"})
                # fstat on the open fd — guarantees X-Mtime matches the bytes read
                # even if a concurrent writer replaces the file between open and read.
                with open(abs_file, "rb") as f:
                    st = os.fstat(f.fileno())
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/markdown")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("X-Mtime", str(st.st_mtime_ns))
                self.end_headers()
                self.wfile.write(data)
                return
            if parsed.path == "/api/notes":
                params = parse_qs(parsed.query)
                target = params.get("file", [""])[0]
                notes = []
                if os.path.isdir(notes_dir):
                    for name in os.listdir(notes_dir):
                        if not name.endswith(".json"):
                            continue
                        try:
                            # macOS-only deployment per spec non-goals; the
                            # default UTF-8 encoding matches the write path.
                            with open(os.path.join(notes_dir, name)) as f:
                                note = json.load(f)
                            if not target or (isinstance(note, dict) and note.get("filePath") == target):
                                notes.append(note)
                        except Exception as exc:
                            # Server runs via nohup with stderr in runtime/trio.log.
                            print(f"[trio] skipping corrupt note {name}: {exc}", file=sys.stderr)
                            continue
                return self._send_json(200, {"notes": notes})
            return self.serve_static(parsed.path)

        def do_PUT(self):
            parsed = urlparse(self.path)
            if parsed.path == "/api/file":
                params = parse_qs(parsed.query)
                rel = params.get("path", [""])[0]
                abs_file = safe_resolve(rel)
                if abs_file is None:
                    return self._send_json(403, {"error": "path escape"})
                lower = abs_file.lower()
                if not (lower.endswith(".md") or lower.endswith(".json")):
                    return self._send_json(400, {"error": "only .md and .json files writable via /api/file"})
                try:
                    length = max(0, int(self.headers.get("Content-Length", "0")))
                except ValueError:
                    return self._send_json(400, {"error": "invalid Content-Length"})
                body = self.rfile.read(length) if length else b""

                if_match = self.headers.get("If-Match")
                if if_match and os.path.isfile(abs_file):
                    current = str(os.stat(abs_file).st_mtime_ns)
                    if current != if_match:
                        return self._send_json(409, {"error": "mtime mismatch", "current_mtime": current})
                # Single-user tool: the stat-to-replace window below is narrow and
                # acceptable. Multi-writer scenarios would require flock.

                # Creating intermediate dirs is intentional — the editor may save
                # to a new subfolder path under cwd_real (safe_resolve already
                # bounded the path to cwd_real).
                os.makedirs(os.path.dirname(abs_file), exist_ok=True)
                tmp = abs_file + ".tmp"
                with open(tmp, "wb") as f:
                    f.write(body)
                os.replace(tmp, abs_file)
                # Plain stat: fd is closed, fstat unavailable. Returned mtime is
                # advisory for the client's next If-Match.
                new_mtime = str(os.stat(abs_file).st_mtime_ns)
                return self._send_json(200, {"ok": True, "mtime": new_mtime})

            if parsed.path == "/api/notes":
                params = parse_qs(parsed.query)
                note_id = params.get("id", [""])[0]
                if not NOTE_ID_RE.match(note_id):
                    return self._send_json(400, {"error": "invalid note id"})
                try:
                    length = max(0, int(self.headers.get("Content-Length", "0")))
                except ValueError:
                    return self._send_json(400, {"error": "invalid Content-Length"})
                body = self.rfile.read(length) if length else b""
                try:
                    json.loads(body)
                except Exception:
                    return self._send_json(400, {"error": "body not valid JSON"})
                os.makedirs(notes_dir, exist_ok=True)
                target = notes_path(note_id)
                tmp = target + ".tmp"
                with open(tmp, "wb") as f:
                    f.write(body)
                os.replace(tmp, target)
                return self._send_json(200, {"ok": True})

            self._send_json(404, {"error": "not found"})

        def do_DELETE(self):
            parsed = urlparse(self.path)
            if parsed.path == "/api/notes":
                params = parse_qs(parsed.query)
                note_id = params.get("id", [""])[0]
                if not NOTE_ID_RE.match(note_id):
                    return self._send_json(400, {"error": "invalid note id"})
                target = notes_path(note_id)
                # os.remove raises FileNotFoundError atomically — no TOCTOU window
                # between the existence check and the delete.
                try:
                    os.remove(target)
                except FileNotFoundError:
                    return self._send_json(404, {"error": "note not found"})
                return self._send_json(200, {"ok": True})
            self._send_json(404, {"error": "not found"})

    return Handler


def make_server(cwd: str, port: int) -> ThreadingHTTPServer:
    cwd_real = os.path.realpath(cwd)
    if not os.path.isdir(cwd_real):
        raise ValueError(f"cwd not a directory: {cwd}")
    return ThreadingHTTPServer(("127.0.0.1", port), make_handler(cwd_real))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--cwd", required=True)
    p.add_argument("--port", type=int, default=8765)
    args = p.parse_args()
    server = make_server(args.cwd, args.port)
    print(f"Trio server listening on http://127.0.0.1:{args.port} cwd={os.path.realpath(args.cwd)}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
