// fs.js — single HTTP wrapper for Trio's file and notes API.
// All paths are relative to the server's bound CWD.

async function jsonOr(resp) {
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    err.status = resp.status;
    try { err.body = await resp.json(); } catch {}
    throw err;
  }
  return resp.json();
}

export async function getMeta() {
  const r = await fetch('/api/meta');
  return jsonOr(r);
}

export async function listDir(path = '/') {
  const r = await fetch(`/api/tree?path=${encodeURIComponent(path)}`);
  return jsonOr(r);
}

export async function readFile(path) {
  const r = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
  if (!r.ok) {
    const err = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const mtime = r.headers.get('X-Mtime');
  const text = await r.text();
  return { text, mtime };
}

export async function writeFile(path, text, mtime = null) {
  const headers = { 'Content-Type': 'text/markdown' };
  if (mtime) headers['If-Match'] = mtime;
  const r = await fetch(`/api/file?path=${encodeURIComponent(path)}`, {
    method: 'PUT', body: text, headers,
  });
  return jsonOr(r);
}

export async function listNotes(filePath) {
  const r = await fetch(`/api/notes?file=${encodeURIComponent(filePath)}`);
  const data = await jsonOr(r);
  return data.notes;
}

export async function putNote(note) {
  const r = await fetch(`/api/notes?id=${encodeURIComponent(note.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note),
  });
  return jsonOr(r);
}

export async function deleteNote(id) {
  const r = await fetch(`/api/notes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  return jsonOr(r);
}
