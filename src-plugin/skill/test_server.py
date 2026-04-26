import json
import os
import shutil
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from server import make_server

FIXTURE = str(Path(__file__).parent / "test_fixture")


class ServerTestBase(unittest.TestCase):
    """Starts a fresh server per test on port 0 (OS assigns)."""

    def setUp(self):
        self.server = make_server(cwd=FIXTURE, port=0)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def get(self, path, headers=None):
        req = urllib.request.Request(self.url(path), headers=headers or {})
        return urllib.request.urlopen(req)


class MetaEndpointTests(ServerTestBase):
    def test_meta_returns_cwd_and_version(self):
        resp = self.get("/api/meta")
        body = json.loads(resp.read())
        self.assertEqual(body["cwd"], os.path.realpath(FIXTURE))
        self.assertIn("version", body)


class TreeEndpointTests(ServerTestBase):
    def test_root_lists_dirs_and_md_files(self):
        resp = self.get("/api/tree")
        body = json.loads(resp.read())
        names = {e["name"]: e["type"] for e in body["entries"]}
        self.assertEqual(names.get("README.md"), "file")
        self.assertEqual(names.get("notes"), "dir")

    def test_subdir_listing(self):
        resp = self.get("/api/tree?path=notes")
        body = json.loads(resp.read())
        names = {e["name"] for e in body["entries"]}
        self.assertIn("alpha.md", names)
        self.assertIn("beta.md", names)
        self.assertIn("subdir", names)

    def test_non_md_files_excluded(self):
        # Add a .txt file to fixture temporarily.
        junk = Path(FIXTURE) / "ignored.txt"
        junk.write_text("junk")
        try:
            resp = self.get("/api/tree")
            names = {e["name"] for e in json.loads(resp.read())["entries"]}
            self.assertNotIn("ignored.txt", names)
        finally:
            junk.unlink()

    def test_json_files_included(self):
        # Navigator needs to list .json files alongside .md.
        j = Path(FIXTURE) / "data.json"
        j.write_text("{}")
        try:
            resp = self.get("/api/tree")
            names = {e["name"] for e in json.loads(resp.read())["entries"]}
            self.assertIn("data.json", names)
        finally:
            j.unlink()

    def test_missing_dir_404(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.get("/api/tree?path=does/not/exist")
        self.assertEqual(ctx.exception.code, 404)

    def test_mtime_is_string_for_js_precision(self):
        # File entries must expose mtime as a string; nanosecond int64 values
        # exceed JS float64's 53-bit mantissa and would truncate on the client.
        resp = self.get("/api/tree")
        files = [e for e in json.loads(resp.read())["entries"] if e["type"] == "file"]
        self.assertGreater(len(files), 0)
        self.assertIsInstance(files[0]["mtime"], str)
        self.assertTrue(files[0]["mtime"].isdigit())

    def test_path_escape_blocked(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.get("/api/tree?path=../../etc")
        self.assertEqual(ctx.exception.code, 403)


class FileReadTests(ServerTestBase):
    def test_read_existing_md(self):
        resp = self.get("/api/file?path=notes/alpha.md")
        self.assertEqual(resp.headers["Content-Type"], "text/markdown")
        self.assertIn("Alpha", resp.read().decode())
        self.assertTrue(resp.headers["X-Mtime"].isdigit())

    def test_read_missing_404(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.get("/api/file?path=nope.md")
        self.assertEqual(ctx.exception.code, 404)

    def test_path_escape_blocked(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.get("/api/file?path=../../etc/passwd")
        self.assertEqual(ctx.exception.code, 403)


class FileWriteTests(ServerTestBase):
    def _put(self, path, body, headers=None):
        req = urllib.request.Request(
            self.url(f"/api/file?path={path}"),
            data=body.encode("utf-8"),
            method="PUT",
            headers=headers or {},
        )
        return urllib.request.urlopen(req)

    def test_write_then_read(self):
        path = "notes/tmp_write.md"
        try:
            resp = self._put(path, "# new\ncontent")
            body = json.loads(resp.read())
            self.assertEqual(body["ok"], True)
            self.assertIsInstance(body["mtime"], str)
            r = self.get(f"/api/file?path={path}")
            self.assertIn("content", r.read().decode())
        finally:
            full = os.path.join(FIXTURE, path)
            os.path.exists(full) and os.remove(full)

    def test_write_non_md_or_json_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._put("notes/evil.sh", "#!/bin/sh\n")
        self.assertEqual(ctx.exception.code, 400)

    def test_write_json_allowed(self):
        path = "notes/tmp_bugs.json"
        try:
            self._put(path, '{"bugs":[]}')
            r = self.get(f"/api/file?path={path}")
            self.assertEqual(r.read().decode(), '{"bugs":[]}')
        finally:
            p = os.path.join(FIXTURE, path)
            if os.path.exists(p):
                os.remove(p)

    def test_if_match_conflict(self):
        path = "notes/tmp_conflict.md"
        try:
            self._put(path, "first")
            with self.assertRaises(urllib.error.HTTPError) as ctx:
                self._put(path, "second", headers={"If-Match": "1"})
            self.assertEqual(ctx.exception.code, 409)
        finally:
            full = os.path.join(FIXTURE, path)
            os.path.exists(full) and os.remove(full)

    def test_if_match_success(self):
        path = "notes/tmp_match.md"
        try:
            self._put(path, "first")
            mtime = os.stat(os.path.join(FIXTURE, path)).st_mtime_ns
            resp = self._put(path, "second", headers={"If-Match": str(mtime)})
            body = json.loads(resp.read())
            self.assertEqual(body["ok"], True)
            self.assertIsInstance(body["mtime"], str)
        finally:
            full = os.path.join(FIXTURE, path)
            os.path.exists(full) and os.remove(full)

    def test_path_escape_blocked_on_put(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._put("../evil.md", "hi")
        self.assertEqual(ctx.exception.code, 403)

    def test_malformed_content_length_rejected(self):
        # Bypass urllib (which would overwrite Content-Length) using raw socket.
        import socket
        raw = (
            f"PUT /api/file?path=notes/bad_cl.md HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{self.port}\r\n"
            f"Content-Length: not-a-number\r\n"
            f"Connection: close\r\n"
            f"\r\n"
        ).encode()
        s = socket.create_connection(("127.0.0.1", self.port))
        try:
            s.sendall(raw)
            resp = s.recv(4096).decode()
        finally:
            s.close()
        self.assertIn("400", resp.split("\r\n", 1)[0])
        self.assertFalse(os.path.exists(os.path.join(FIXTURE, "notes/bad_cl.md")))


class NotesApiTests(ServerTestBase):
    def tearDown(self):
        super().tearDown()
        # Clean up any notes the tests created.
        trio_dir = Path(FIXTURE) / "trio"
        if trio_dir.exists():
            shutil.rmtree(trio_dir)

    def _put_note(self, note_id, payload):
        req = urllib.request.Request(
            self.url(f"/api/notes?id={note_id}"),
            data=json.dumps(payload).encode(),
            method="PUT",
            headers={"Content-Type": "application/json"},
        )
        return urllib.request.urlopen(req)

    def _delete_note(self, note_id):
        req = urllib.request.Request(self.url(f"/api/notes?id={note_id}"), method="DELETE")
        return urllib.request.urlopen(req)

    def test_put_list_delete_cycle(self):
        self._put_note("n1", {"id": "n1", "filePath": "notes/alpha.md", "text": "hi"})
        self._put_note("n2", {"id": "n2", "filePath": "notes/alpha.md", "text": "yo"})
        self._put_note("n3", {"id": "n3", "filePath": "notes/beta.md", "text": "elsewhere"})

        resp = self.get("/api/notes?file=notes/alpha.md")
        ids = sorted(n["id"] for n in json.loads(resp.read())["notes"])
        self.assertEqual(ids, ["n1", "n2"])

        self._delete_note("n1")
        resp = self.get("/api/notes?file=notes/alpha.md")
        ids = sorted(n["id"] for n in json.loads(resp.read())["notes"])
        self.assertEqual(ids, ["n2"])

    def test_bad_note_id_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._put_note("../../../evil", {"id": "x", "filePath": "a"})
        self.assertEqual(ctx.exception.code, 400)

    def test_delete_missing_404(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._delete_note("nope")
        self.assertEqual(ctx.exception.code, 404)

    def test_invalid_json_body_rejected(self):
        req = urllib.request.Request(
            self.url("/api/notes?id=n_bad_json"),
            data=b"not json",
            method="PUT",
            headers={"Content-Type": "application/json"},
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 400)


class StaticFileTests(ServerTestBase):
    def test_root_serves_index_html(self):
        resp = self.get("/")
        self.assertEqual(resp.headers["Content-Type"].split(";")[0], "text/html")
        self.assertIn("Trio", resp.read().decode())

    def test_unknown_path_404(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.get("/nothing.js")
        self.assertEqual(ctx.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
