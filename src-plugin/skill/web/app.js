import { getMeta, listDir, readFile, writeFile, listNotes, putNote, deleteNote } from './fs.js';

const mermaid = window.mermaid || null;
if (mermaid) {
  try {
    mermaid.initialize({ startOnLoad: false, theme: 'default', fontSize: 12, themeVariables: { fontSize: '12px' } });
  } catch (e) {
    console.warn('Mermaid init failed:', e);
  }
}

// ============================================================
// Toast Notifications
// ============================================================
function showToast(message, duration = 4000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Theme toggle ──
const THEME_KEY = 'trio-theme';
const FONT_KEY = 'trio-font-size';
const MIN_FONT = 12;
const MAX_FONT = 24;
const FONT_STEP = 2;
const DEFAULT_FONT = 16;

function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  document.getElementById('btn-theme').textContent = theme === 'dark' ? 'Light' : 'Dark';
}

function getInitialFontSize() {
  const saved = localStorage.getItem(FONT_KEY);
  return saved ? parseInt(saved, 10) : DEFAULT_FONT;
}

function applyFontSize(size) {
  size = Math.max(MIN_FONT, Math.min(MAX_FONT, size));
  document.documentElement.style.setProperty('--font-size', size + 'px');
  localStorage.setItem(FONT_KEY, String(size));
  document.getElementById('font-size-label').textContent = size + 'px';
  return size;
}

// Init
let currentTheme = getInitialTheme();
applyTheme(currentTheme);
let currentFontSize = getInitialFontSize();
applyFontSize(currentFontSize);

// Listeners
document.getElementById('btn-theme').addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme);
});
function onFontSizeChange(delta) {
  currentFontSize = applyFontSize(currentFontSize + delta);
  requestAnimationFrame(() => {
    try {
      syncMdLineGutterLayout();
      updateRiskNav();
      if (activePopup && activePopup._anchorEl && document.body.contains(activePopup._anchorEl)) {
        positionPopupNear(activePopup, activePopup._anchorEl);
      }
      if (activeTooltip && activeTooltip._anchorEl && document.body.contains(activeTooltip._anchorEl)) {
        positionPopupNear(activeTooltip, activeTooltip._anchorEl);
      }
    } catch(e) { /* notes not initialized yet */ }
  });
}

document.getElementById('btn-font-down').addEventListener('click', () => onFontSizeChange(-FONT_STEP));
document.getElementById('btn-font-up').addEventListener('click', () => onFontSizeChange(FONT_STEP));

// ── Resizable divider ──
const divider = document.getElementById('divider');
const mainLayout = document.querySelector('.main-layout');
let isDragging = false;

function handleMouseMove(e) {
  if (!isDragging) return;
  const minWidth = 150;
  const maxWidth = window.innerWidth * 0.5;
  let newWidth = Math.max(minWidth, Math.min(maxWidth, e.clientX));
  mainLayout.style.gridTemplateColumns = `${newWidth}px var(--divider-width) 1fr`;
}

divider.addEventListener('mousedown', (e) => {
  isDragging = true;
  divider.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', handleMouseMove);
  e.preventDefault();
});

document.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  divider.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  document.removeEventListener('mousemove', handleMouseMove);
});

// ── Resizable outline divider ──
const outlineDivider = document.getElementById('outline-divider');
const outlinePanel = document.getElementById('outline-panel');
let isOutlineDragging = false;

function handleOutlineMove(e) {
  if (!isOutlineDragging) return;
  // outline-panel left edge = content pane left edge
  const contentLeft = outlinePanel.parentElement.getBoundingClientRect().left;
  const newWidth = e.clientX - contentLeft;
  const clamped = Math.max(120, Math.min(400, newWidth));
  outlinePanel.style.width = clamped + 'px';
}

outlineDivider.addEventListener('mousedown', (e) => {
  isOutlineDragging = true;
  outlineDivider.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.addEventListener('mousemove', handleOutlineMove);
  e.preventDefault();
});

document.addEventListener('mouseup', () => {
  if (!isOutlineDragging) return;
  isOutlineDragging = false;
  outlineDivider.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  document.removeEventListener('mousemove', handleOutlineMove);
});

// ============================================================
// trio/notes — Notes CRUD (HTTP via fs.js)
// ============================================================
async function saveNote(note) {
  await putNote(note);
}

async function deleteNoteById(noteId) {
  try { await deleteNote(noteId); } catch (e) { if (e.status !== 404) throw e; }
}

async function loadNotesForFile(filePath) {
  return await listNotes(filePath);
}

// ============================================================
// File System
// ============================================================
let fileTree = null; // { name, kind, children? }
let currentFilePath = null;
let currentFileMtime = null;

function getFilePath(entry, tree) {
  // Recursively search the file tree to build relative path
  function search(entries, pathParts) {
    for (const e of entries) {
      if (e === entry) return [...pathParts, e.name].join('/');
      if (e.kind === 'directory' && e.children) {
        const result = search(e.children, [...pathParts, e.name]);
        if (result) return result;
      }
    }
    return null;
  }
  return search(tree, []);
}

function resolveRelativePath(currentFilePath, src) {
  const currentDir = currentFilePath.includes('/') ? currentFilePath.replace(/\/[^/]+$/, '') : '';
  const combined = currentDir ? currentDir + '/' + src : src;
  const parts = combined.split('/');
  const resolved = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') { resolved.pop(); continue; }
    resolved.push(p);
  }
  return resolved;
}

let activeBlobUrls = [];

function revokeActiveBlobUrls() {
  for (const url of activeBlobUrls) URL.revokeObjectURL(url);
  activeBlobUrls = [];
}

async function resolvePreviewImages(previewContent, basePath = currentFilePath) {
  if (!basePath) return;
  const images = previewContent.querySelectorAll('img');
  if (images.length === 0) return;

  const promises = Array.from(images).map(async (img) => {
    const src = img.getAttribute('src');
    if (!src) return;
    // Skip external URLs and data URIs
    if (/^(https?:\/\/|data:|blob:)/i.test(src)) return;

    try {
      const pathParts = resolveRelativePath(basePath, src);
      const resolvedPath = pathParts.join('/');
      const resp = await fetch(`/api/file?path=${encodeURIComponent(resolvedPath)}`);
      if (!resp.ok) return;
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      activeBlobUrls.push(blobUrl);
      img.src = blobUrl;
    } catch {
      // File not found — leave src as-is
    }
  });
  await Promise.all(promises);
}

const ROOT_FOLDERS = ['docs', 'trio'];

async function buildTreeFromServer(path) {
  const { entries } = await listDir(path);
  const node = { name: path === '/' ? '' : path.split('/').pop(), kind: 'directory', children: [] };
  for (const e of entries) {
    if (e.type === 'dir') {
      const childPath = path === '/' ? e.name : `${path}/${e.name}`;
      node.children.push(await buildTreeFromServer(childPath));
    } else if (e.type === 'file') {
      node.children.push({ name: e.name, kind: 'file' });
    }
  }
  return node;
}

async function buildRootTreeFromServer() {
  const { entries } = await listDir('/');
  const rootNames = new Set(entries.filter(e => e.type === 'dir').map(e => e.name));
  const children = [];
  for (const name of ROOT_FOLDERS) {
    if (!rootNames.has(name)) continue;
    children.push(await buildTreeFromServer(name));
  }
  return { name: '', kind: 'directory', children };
}

function getExpandedFolderPaths() {
  const paths = [];
  document.querySelectorAll('.tree-children').forEach(el => {
    if (!el.classList.contains('collapsed')) {
      const item = el.previousElementSibling;
      if (item) paths.push(item.getAttribute('data-folder-path'));
    }
  });
  return paths.filter(Boolean);
}

function restoreExpandedFolders(paths) {
  if (!paths || paths.length === 0) return;
  const pathSet = new Set(paths);
  document.querySelectorAll('.tree-item[data-folder-path]').forEach(item => {
    if (pathSet.has(item.getAttribute('data-folder-path'))) {
      const childrenEl = item.nextElementSibling;
      if (childrenEl && childrenEl.classList.contains('tree-children')) {
        childrenEl.classList.remove('collapsed');
        item.querySelector('.arrow').classList.add('expanded');
      }
    }
  });
}

function renderTree(entries, container, depth = 0, parentPath = '') {
  container.innerHTML = '';
  for (const entry of entries) {
    if (entry.kind === 'directory') {
      const folderPath = parentPath ? parentPath + '/' + entry.name : entry.name;
      const folderEl = document.createElement('div');

      const itemEl = document.createElement('div');
      itemEl.className = 'tree-item';
      itemEl.setAttribute('data-folder-path', folderPath);
      itemEl.style.paddingLeft = (8 + depth * 16) + 'px';
      itemEl.innerHTML = `
        <span class="arrow">&#9654;</span>
        <span class="icon">&#128193;</span>
        <span class="label">${entry.name}</span>
      `;

      const childrenEl = document.createElement('div');
      childrenEl.className = 'tree-children collapsed';
      renderTree(entry.children, childrenEl, depth + 1, folderPath);

      itemEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const arrow = itemEl.querySelector('.arrow');
        const isCollapsed = childrenEl.classList.toggle('collapsed');
        arrow.classList.toggle('expanded', !isCollapsed);
      });

      folderEl.appendChild(itemEl);
      folderEl.appendChild(childrenEl);
      container.appendChild(folderEl);
    } else {
      const itemEl = document.createElement('div');
      itemEl.className = 'tree-item';
      itemEl.style.paddingLeft = (8 + depth * 16) + 'px';
      itemEl.innerHTML = `
        <span class="arrow" style="visibility:hidden">&#9654;</span>
        <span class="icon">&#128196;</span>
        <span class="label">${entry.name}</span>
      `;
      const filePath = parentPath ? parentPath + '/' + entry.name : entry.name;
      itemEl.addEventListener('click', (e) => {
        e.stopPropagation();
        selectFile(entry, filePath);
        // Highlight
        document.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
        itemEl.classList.add('selected');
      });
      container.appendChild(itemEl);
    }
  }
}

async function loadRootFromServer() {
  const meta = await getMeta();
  const folderLabel = document.getElementById('folder-path');
  if (folderLabel) { folderLabel.textContent = meta.cwd; folderLabel.style.display = ''; }
  document.title = meta.cwd + ' — Trio';
  fileTree = await buildRootTreeFromServer();
  renderTree(fileTree.children, document.getElementById('sidebar'));
  document.getElementById('welcome').style.display = 'none';
  document.getElementById('btn-refresh').style.display = '';
}

// ============================================================
// JSON view — render a .json file as a table
// ============================================================
let currentJsonData = null;           // unwrapped payload
let currentJsonFileHandle = null;     // unused in plugin (HTTP writeFile instead)
let currentJsonFilePath = null;       // server-relative path, used for writes + images
let currentJsonHistory = [];          // preserved _history array
let jsonWasArrayEnvelope = false;     // true if file was (or should be) wrapped
let jsonOriginalSnapshot = null;      // deep clone of payload at load/last save
let jsonDirty = false;

// Envelope: every JSON file gains a top-level _history array.
function unwrapOnLoad(raw) {
  if (isPlainObject(raw) && Array.isArray(raw._history)) {
    const history = raw._history;
    const keys = Object.keys(raw).filter(k => k !== '_history');
    if (keys.length === 1 && keys[0] === 'data' && Array.isArray(raw.data)) {
      return { payload: raw.data, history, wasArrayEnvelope: true };
    }
    const payload = {};
    for (const k of keys) payload[k] = raw[k];
    return { payload, history, wasArrayEnvelope: false };
  }
  return { payload: raw, history: [], wasArrayEnvelope: Array.isArray(raw) };
}

function wrapForWrite(payload, history, wasArrayEnvelope) {
  if (wasArrayEnvelope || Array.isArray(payload)) {
    return { _history: history, data: payload };
  }
  const out = { _history: history };
  for (const k of Object.keys(payload)) out[k] = payload[k];
  return out;
}

function deepClonePayload(v) {
  return structuredClone(v);
}

function updateDirtyUi() {
  const saveBtn = document.getElementById('btn-save-json');
  const nameEl = document.getElementById('file-name');
  if (saveBtn) saveBtn.classList.toggle('dirty', jsonDirty);
  if (nameEl) nameEl.classList.toggle('dirty', jsonDirty);
}

function markJsonDirty() {
  if (!jsonDirty) {
    jsonDirty = true;
    updateDirtyUi();
  }
}

function clearJsonDirty() {
  jsonDirty = false;
  updateDirtyUi();
}

// Structural diff: returns array of {path, from?, to?} entries.
function computeJsonDiff(before, after, pathPrefix = '') {
  const entries = [];
  const bothObj = isPlainObject(before) && isPlainObject(after);
  const bothArr = Array.isArray(before) && Array.isArray(after);

  if (bothObj) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) {
      const childPath = pathPrefix === '' ? k : pathPrefix + '.' + k;
      const inBefore = k in before;
      const inAfter = k in after;
      if (inBefore && inAfter) {
        entries.push(...computeJsonDiff(before[k], after[k], childPath));
      } else if (inAfter) {
        entries.push({ path: childPath, to: after[k] });
      } else {
        entries.push({ path: childPath, from: before[k] });
      }
    }
    return entries;
  }

  if (bothArr) {
    const len = Math.max(before.length, after.length);
    for (let i = 0; i < len; i++) {
      const childPath = pathPrefix + '[' + i + ']';
      const inBefore = i < before.length;
      const inAfter = i < after.length;
      if (inBefore && inAfter) {
        entries.push(...computeJsonDiff(before[i], after[i], childPath));
      } else if (inAfter) {
        entries.push({ path: childPath, to: after[i] });
      } else {
        entries.push({ path: childPath, from: before[i] });
      }
    }
    return entries;
  }

  if (!Object.is(before, after)) {
    entries.push({ path: pathPrefix, from: before, to: after });
  }
  return entries;
}

async function saveCurrentJson() {
  if (!currentJsonFilePath || currentJsonData === null) return;

  const changes = computeJsonDiff(jsonOriginalSnapshot, currentJsonData);
  if (changes.length === 0) {
    showToast('No changes to save');
    return;
  }

  try {
    const newHistory = [
      { savedAt: new Date().toISOString(), changes },
      ...currentJsonHistory,
    ];
    const onDisk = wrapForWrite(currentJsonData, newHistory, jsonWasArrayEnvelope);

    await writeFile(currentJsonFilePath, JSON.stringify(onDisk, null, 2));

    currentJsonHistory = newHistory;
    jsonOriginalSnapshot = deepClonePayload(currentJsonData);
    jsonDirty = false;
    updateDirtyUi();
  } catch (err) {
    showToast('Failed to save JSON: ' + (err.message || err));
  }
}

function showJsonTable(fileName, data) {
  const previewContent = getMdPreviewContent();
  const contentBody = document.querySelector('.content-body');
  const outlineList = document.getElementById('outline-list');
  if (!previewContent || !contentBody) return;

  // Reset md/file state — JSON view is independent of selected markdown file
  currentFilePath = null;
  currentMarkdown = null;
  currentFileNotes = [];
  removeActivePopup();
  removeActiveTooltip();

  // Hide sidebar + outline in JSON view
  document.body.classList.add('json-view');

  document.getElementById('welcome').style.display = 'none';
  document.getElementById('content-toolbar').classList.add('visible');
  document.getElementById('file-name').textContent = fileName;
  outlineList.innerHTML = '';
  const gutter = document.getElementById('md-line-gutter');
  if (gutter) gutter.innerHTML = '';

  previewContent.innerHTML = '';
  revokeActiveBlobUrls();
  if (isGapCheckSchema(data)) {
    renderGapCheckView(previewContent, data);
  } else if (isBugListSchema(data)) {
    renderBugCardsView(previewContent, data);
  } else if (isBugReportSchema(data)) {
    renderBugReportView(previewContent, data);
  } else {
    previewContent.appendChild(buildJsonTable(data));
  }
  contentBody.classList.add('visible');

  // Swap relative image paths (e.g. screenshots/foo.png) into blob URLs.
  if (currentJsonFilePath) {
    resolvePreviewImages(previewContent, currentJsonFilePath);
  }

  try {
    currentNoteIndex = -1;
    updateNoteNav();
    currentRiskIndex = -1;
    updateRiskNav();
  } catch (e) {}

  clearJsonDirty();
}

function formatJsonCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function renderJsonValue(v) {
  // Returns a Node suitable for placing inside a <td>
  if (v === null || v === undefined) return document.createTextNode('');
  if (typeof v !== 'object') return document.createTextNode(formatJsonCell(v));
  // Nested object or array → nested table
  if (Array.isArray(v) && v.length === 0) {
    const span = document.createElement('span');
    span.textContent = '[]';
    span.style.color = 'var(--sidebar-text)';
    return span;
  }
  if (isPlainObject(v) && Object.keys(v).length === 0) {
    const span = document.createElement('span');
    span.textContent = '{}';
    span.style.color = 'var(--sidebar-text)';
    return span;
  }
  return buildJsonTable(v);
}

function buildJsonTable(data) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  table.appendChild(thead);
  table.appendChild(tbody);

  const addHeader = (cols) => {
    const tr = document.createElement('tr');
    for (const c of cols) {
      const th = document.createElement('th');
      th.textContent = c;
      tr.appendChild(th);
    }
    thead.appendChild(tr);
  };
  const addRow = (values) => {
    const tr = document.createElement('tr');
    for (const v of values) {
      const td = document.createElement('td');
      td.appendChild(renderJsonValue(v));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  };

  if (Array.isArray(data) && data.length > 0 && data.every(isPlainObject)) {
    // Array of objects — union of keys as columns
    const keys = [];
    const seen = new Set();
    for (const row of data) {
      for (const k of Object.keys(row)) {
        if (!seen.has(k)) { seen.add(k); keys.push(k); }
      }
    }
    addHeader(keys);
    for (const row of data) {
      const tr = document.createElement('tr');
      for (const k of keys) {
        const td = document.createElement('td');
        if (k === 'decision') {
          td.classList.add('json-decision-cell');
          td.contentEditable = 'true';
          td.spellcheck = false;
          td.textContent = formatJsonCell(row[k]);
          td.addEventListener('blur', () => {
            const newVal = td.textContent;
            if (row[k] !== newVal) {
              row[k] = newVal;
              markJsonDirty();
            }
          });
          td.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              td.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              td.textContent = formatJsonCell(row[k]);
              td.blur();
            }
          });
        } else {
          td.appendChild(renderJsonValue(row[k]));
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  } else if (Array.isArray(data)) {
    // Array of primitives (or mixed) — single column
    addHeader(['value']);
    for (const v of data) addRow([v]);
  } else if (isPlainObject(data)) {
    // Single object — key/value table
    addHeader(['key', 'value']);
    for (const [k, v] of Object.entries(data)) addRow([k, v]);
  } else {
    // Primitive
    addHeader(['type', 'value']);
    addRow([data === null ? 'null' : typeof data, data]);
  }

  return table;
}

function isGapCheckSchema(data) {
  return isPlainObject(data)
    && isPlainObject(data.part1_prd_beyond_urs)
    && isPlainObject(data.part2_urs_not_in_prd)
    && isPlainObject(data.part3_prd_marked_pending);
}

// Column configs for each Gap Check part.
// width: initial px width for the <col>. resizable: whether to show a drag handle.
const GAP_CHECK_PART_CONFIGS = {
  part1_prd_beyond_urs: {
    title: 'Part 1 — PRD 已实现但 URS 未提及',
    columns: [
      { label: 'ID', get: r => r.id, width: '5%' },
      { label: 'Module', get: r => r.module, width: '20%', resizable: true },
      { label: 'Feature', get: r => r.feature, width: '25%', resizable: true },
      { label: 'Note', get: r => r.note, width: '25%', resizable: true, linkedTo: 'decision' },
    ],
  },
  part2_urs_not_in_prd: {
    title: 'Part 2 — URS 中明确但 PRD 未覆盖',
    columns: [
      { label: 'ID', get: r => r.id, width: '5%' },
      { label: 'Module', get: r => r.prd_status, width: '20%', resizable: true },
      { label: 'Feature', get: r => r.urs_requirement, width: '25%', resizable: true },
      { label: 'Note', get: r => r.gap, width: '25%', resizable: true, linkedTo: 'decision' },
    ],
  },
  part3_prd_marked_pending: {
    title: 'Part 3 — PRD 标记为待实现',
    columns: [
      { label: 'ID', get: r => r.id, width: '5%' },
      { label: 'Module', get: r => r.module, width: '20%', resizable: true },
      { label: 'Feature', get: r => r.feature, width: '25%', resizable: true },
      { label: 'Note', get: r => r.status_marker, width: '25%', resizable: true, linkedTo: 'decision' },
    ],
  },
};
const GAP_CHECK_DECISION_WIDTH = '25%';

function renderGapCheckView(container, data) {
  // Header block: title / date / scope
  const header = document.createElement('div');
  header.className = 'gap-check-header';
  if (data.title) {
    const h = document.createElement('h2');
    h.textContent = data.title;
    header.appendChild(h);
  }
  const meta = document.createElement('div');
  meta.className = 'gap-check-meta';
  if (data.date) {
    const span = document.createElement('span');
    span.textContent = 'Date: ' + data.date;
    meta.appendChild(span);
  }
  if (isPlainObject(data.scope)) {
    for (const [k, v] of Object.entries(data.scope)) {
      const span = document.createElement('span');
      span.textContent = `${k}: ${v}`;
      meta.appendChild(span);
    }
  }
  if (meta.childNodes.length) header.appendChild(meta);
  container.appendChild(header);

  // Three part tables
  for (const [partKey, config] of Object.entries(GAP_CHECK_PART_CONFIGS)) {
    const part = data[partKey];
    if (!isPlainObject(part)) continue;

    const section = document.createElement('section');
    section.className = 'gap-check-section';

    const h3 = document.createElement('h3');
    h3.textContent = config.title;
    section.appendChild(h3);

    if (part.description) {
      const p = document.createElement('p');
      p.className = 'gap-check-description';
      p.textContent = part.description;
      section.appendChild(p);
    }

    const items = Array.isArray(part.items) ? part.items : [];
    section.appendChild(buildGapCheckTable(items, config));
    container.appendChild(section);
  }

  // Bottom notes (if any)
  if (Array.isArray(data.notes) && data.notes.length > 0) {
    const section = document.createElement('section');
    section.className = 'gap-check-section';
    const h3 = document.createElement('h3');
    h3.textContent = 'Notes';
    section.appendChild(h3);
    const ul = document.createElement('ul');
    for (const n of data.notes) {
      const li = document.createElement('li');
      li.textContent = typeof n === 'string' ? n : JSON.stringify(n);
      ul.appendChild(li);
    }
    section.appendChild(ul);
    container.appendChild(section);
  }
}

// ----- Bug list schema (array of bug objects) -----

const BUG_FIELD_LABELS = {
  id: 'ID',
  testCaseId: 'Test Case ID',
  module: 'Module',
  severity: 'Severity',
  summary: 'Summary',
  url: 'URL',
  reproSteps: 'Repro Steps',
  expectedResult: 'Expected Result',
  actualResult: 'Actual Result',
  screenshot: 'Screenshot',
};
const BUG_FIELD_ORDER = Object.keys(BUG_FIELD_LABELS);
const BUG_DECISION_OPTIONS = [
  'AI to Fix',
  'Create Bug in ADO',
  "Won't Fix",
  'Defer',
];

function isBugListSchema(data) {
  if (!Array.isArray(data) || data.length === 0) return false;
  if (!data.every(isPlainObject)) return false;
  // Accept if ANY item looks like a bug — bug fields vary per entry.
  const looksBug = (item) =>
    ('testCaseId' in item) ||
    ('TestCaseId' in item) ||
    ('test_case_id' in item) ||
    ('reproSteps' in item) ||
    ('Decision' in item && 'severity' in item) ||
    ('decision' in item && 'severity' in item);
  return data.some(looksBug);
}

function getDecisionKey(row) {
  if ('Decision' in row) return 'Decision';
  if ('decision' in row) return 'decision';
  return 'Decision';
}
function getDecisionNoteKey(row) {
  const base = getDecisionKey(row);
  return base === 'Decision' ? 'DecisionNote' : 'decisionNote';
}

function renderBugFieldValue(value) {
  if (value === null || value === undefined || value === '') {
    const span = document.createElement('span');
    span.className = 'bug-field-empty';
    span.textContent = '—';
    return span;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // Image path → <img> (resolved to blob URL later by resolvePreviewImages)
    if (/\.(png|jpe?g|gif|webp|svg|bmp)(\?.*)?$/i.test(trimmed) && !/\s/.test(trimmed)) {
      const img = document.createElement('img');
      img.src = trimmed;
      img.alt = trimmed;
      img.className = 'bug-field-image';
      img.loading = 'lazy';
      return img;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      const a = document.createElement('a');
      a.href = trimmed;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = value;
      return a;
    }
    const div = document.createElement('div');
    div.className = 'bug-field-text';
    div.textContent = value;
    return div;
  }
  if (typeof value !== 'object') {
    const div = document.createElement('div');
    div.className = 'bug-field-text';
    div.textContent = String(value);
    return div;
  }
  if (Array.isArray(value)) {
    const ol = document.createElement('ol');
    ol.className = 'bug-field-list';
    for (const item of value) {
      const li = document.createElement('li');
      if (isPlainObject(item)) {
        const keys = Object.keys(item);
        if (keys.length === 1) {
          li.appendChild(renderBugFieldValue(item[keys[0]]));
        } else {
          li.appendChild(renderBugFieldValue(item));
        }
      } else {
        li.appendChild(renderBugFieldValue(item));
      }
      ol.appendChild(li);
    }
    return ol;
  }
  const dl = document.createElement('dl');
  dl.className = 'bug-field-dl';
  for (const [k, v] of Object.entries(value)) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.appendChild(renderBugFieldValue(v));
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  return dl;
}

function createBugDecisionSection(row) {
  const section = document.createElement('div');
  section.className = 'bug-field bug-decision';

  const label = document.createElement('div');
  label.className = 'bug-field-label';
  label.textContent = 'Decision';
  section.appendChild(label);

  const body = document.createElement('div');
  body.className = 'bug-field-body';
  section.appendChild(body);

  const decisionKey = getDecisionKey(row);
  const noteKey = getDecisionNoteKey(row);
  const currentRaw = row[decisionKey] == null ? '' : String(row[decisionKey]);
  const currentNote = row[noteKey] == null ? '' : String(row[noteKey]);

  const groupName = 'bug-decision-' + (++decisionGroupSeq);
  const radios = {};

  const radioRow = document.createElement('div');
  radioRow.className = 'bug-decision-radios';
  for (const opt of BUG_DECISION_OPTIONS) {
    const id = groupName + '-' + opt.replace(/\s+/g, '-').replace(/'/g, '');
    const lbl = document.createElement('label');
    lbl.className = 'bug-decision-radio';
    const r = document.createElement('input');
    r.type = 'radio';
    r.name = groupName;
    r.value = opt;
    r.id = id;
    lbl.htmlFor = id;
    lbl.appendChild(r);
    lbl.appendChild(document.createTextNode(' ' + opt));
    radioRow.appendChild(lbl);
    radios[opt] = r;
  }
  body.appendChild(radioRow);

  if (BUG_DECISION_OPTIONS.includes(currentRaw)) {
    radios[currentRaw].checked = true;
  }

  const input = document.createElement('textarea');
  input.className = 'bug-decision-input';
  input.rows = 2;
  input.placeholder = 'Additional notes (optional)…';
  input.value = currentNote;
  body.appendChild(input);

  const commitRadio = (val) => {
    if (row[decisionKey] === val) return;
    row[decisionKey] = val;
    markJsonDirty();
  };
  const commitNote = (val) => {
    if (row[noteKey] === val) return;
    if (val === '' && !(noteKey in row)) return;
    row[noteKey] = val;
    markJsonDirty();
  };

  for (const opt of BUG_DECISION_OPTIONS) {
    radios[opt].addEventListener('change', () => {
      if (radios[opt].checked) commitRadio(opt);
    });
  }
  input.addEventListener('blur', () => commitNote(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      input.value = row[noteKey] == null ? '' : String(row[noteKey]);
      input.blur();
    }
  });

  return section;
}

function buildBugField(labelText, value) {
  const field = document.createElement('div');
  field.className = 'bug-field';
  const label = document.createElement('div');
  label.className = 'bug-field-label';
  label.textContent = labelText;
  const body = document.createElement('div');
  body.className = 'bug-field-body';
  body.appendChild(renderBugFieldValue(value));
  field.appendChild(label);
  field.appendChild(body);
  return field;
}

function renderBugCardsView(container, bugs) {
  const wrap = document.createElement('div');
  wrap.className = 'bug-cards';

  bugs.forEach((bug, idx) => {
    const card = document.createElement('article');
    card.className = 'bug-card';

    const header = document.createElement('header');
    header.className = 'bug-card-header';
    const title = document.createElement('div');
    title.className = 'bug-card-title';
    title.textContent = 'Bug #' + (bug.id ?? idx + 1);
    header.appendChild(title);
    if (bug.severity) {
      const sev = document.createElement('span');
      sev.className = 'bug-severity bug-severity-' + String(bug.severity).toLowerCase();
      sev.textContent = bug.severity;
      header.appendChild(sev);
    }
    card.appendChild(header);

    const decisionKey = getDecisionKey(bug);
    const noteKey = getDecisionNoteKey(bug);
    const skipKeys = new Set([decisionKey, noteKey, 'severity']);

    const renderedKeys = new Set();
    for (const key of BUG_FIELD_ORDER) {
      if (!(key in bug) || skipKeys.has(key)) continue;
      card.appendChild(buildBugField(BUG_FIELD_LABELS[key], bug[key]));
      renderedKeys.add(key);
    }
    for (const [k, v] of Object.entries(bug)) {
      if (renderedKeys.has(k) || skipKeys.has(k)) continue;
      card.appendChild(buildBugField(k, v));
    }

    card.appendChild(createBugDecisionSection(bug));
    wrap.appendChild(card);
  });

  container.appendChild(wrap);
}

function isBugReportSchema(data) {
  return isPlainObject(data) && Array.isArray(data.bugs) && isBugListSchema(data.bugs);
}

function renderBugReportView(container, data) {
  // Report header: title, date, environment, summary
  const header = document.createElement('header');
  header.className = 'bug-report-header';

  if (data.reportName) {
    const h = document.createElement('h2');
    h.className = 'bug-report-title';
    h.textContent = data.reportName;
    header.appendChild(h);
  }

  const meta = document.createElement('div');
  meta.className = 'bug-report-meta';
  if (data.testDate) {
    const span = document.createElement('span');
    span.innerHTML = '<strong>Test Date:</strong> ' + escapeHtml(data.testDate);
    meta.appendChild(span);
  }
  if (isPlainObject(data.environment)) {
    for (const [k, v] of Object.entries(data.environment)) {
      const span = document.createElement('span');
      span.innerHTML = '<strong>' + escapeHtml(k) + ':</strong> ' + escapeHtml(String(v));
      meta.appendChild(span);
    }
  }
  if (meta.childNodes.length) header.appendChild(meta);

  if (isPlainObject(data.summary)) {
    const s = document.createElement('div');
    s.className = 'bug-report-summary';
    const entries = Object.entries(data.summary);
    for (const [k, v] of entries) {
      const pill = document.createElement('span');
      pill.className = 'bug-report-summary-pill';
      pill.innerHTML = '<strong>' + escapeHtml(k) + '</strong><span>' + escapeHtml(String(v)) + '</span>';
      s.appendChild(pill);
    }
    header.appendChild(s);
  }

  container.appendChild(header);
  renderBugCardsView(container, data.bugs);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

const DECISION_PRESETS = ['Change URS', 'Change PRD'];
const DECISION_OTHERS = 'others';
let decisionGroupSeq = 0;

function createDecisionCell(row) {
  const td = document.createElement('td');
  td.classList.add('json-decision-cell');

  const current = row.decision == null ? '' : String(row.decision);
  const groupName = 'decision-' + (++decisionGroupSeq);

  const wrap = document.createElement('div');
  wrap.className = 'decision-radios';

  const options = [
    { label: 'No Decision', value: '' },
    { label: 'Change URS', value: 'Change URS' },
    { label: 'Change PRD', value: 'Change PRD' },
    { label: 'Others', value: DECISION_OTHERS },
  ];

  const radios = {};
  for (const o of options) {
    const id = groupName + '-' + o.value.replace(/\s+/g, '-');
    const label = document.createElement('label');
    label.className = 'decision-radio';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = groupName;
    radio.value = o.value;
    radio.id = id;
    label.htmlFor = id;
    label.appendChild(radio);
    label.appendChild(document.createTextNode(' ' + o.label));
    wrap.appendChild(label);
    radios[o.value] = radio;
  }

  const input = document.createElement('textarea');
  input.className = 'decision-input';
  input.rows = 2;
  input.placeholder = 'Type your decision…';

  // Determine initial state from existing value
  if (DECISION_PRESETS.includes(current)) {
    radios[current].checked = true;
    input.style.display = 'none';
  } else if (current !== '') {
    radios[DECISION_OTHERS].checked = true;
    input.value = current;
    input.style.display = '';
  } else {
    radios[''].checked = true;
    input.style.display = 'none';
  }

  const commit = (newVal) => {
    if (row.decision !== newVal) {
      row.decision = newVal;
      markJsonDirty();
    }
  };

  for (const o of options) {
    radios[o.value].addEventListener('change', () => {
      if (!radios[o.value].checked) return;
      if (o.value === DECISION_OTHERS) {
        input.style.display = '';
        requestAnimationFrame(() => input.focus());
        commit(input.value);
      } else {
        input.style.display = 'none';
        input.value = '';
        commit(o.value); // '' for No Decision, or preset string
      }
    });
  }

  input.addEventListener('blur', () => {
    commit(input.value);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      input.value = row.decision == null ? '' : String(row.decision);
      input.blur();
    }
  });

  td.appendChild(wrap);
  td.appendChild(input);
  return td;
}

function attachColumnResizer(th, colEl, linkedColEl) {
  const handle = document.createElement('div');
  handle.className = 'col-resize-handle';
  th.appendChild(handle);

  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colEl.getBoundingClientRect().width;
    const linkedStartWidth = linkedColEl ? linkedColEl.getBoundingClientRect().width : 0;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';

    const onMove = (ev) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(60, startWidth + delta);
      colEl.style.width = newWidth + 'px';
      if (linkedColEl) {
        const linkedNew = Math.max(60, linkedStartWidth - delta);
        linkedColEl.style.width = linkedNew + 'px';
      }
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  });
}

function buildGapCheckTable(items, config) {
  const table = document.createElement('table');
  table.className = 'gap-check-table';
  const colgroup = document.createElement('colgroup');
  const colEls = [];
  for (const col of config.columns) {
    const c = document.createElement('col');
    c.style.width = col.width;
    colgroup.appendChild(c);
    colEls.push(c);
  }
  const colDecision = document.createElement('col');
  colDecision.style.width = GAP_CHECK_DECISION_WIDTH;
  colgroup.appendChild(colDecision);
  colEls.push(colDecision);
  table.appendChild(colgroup);

  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');
  table.appendChild(thead);
  table.appendChild(tbody);

  const headerRow = document.createElement('tr');
  config.columns.forEach((col, i) => {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.resizable) {
      const linked = col.linkedTo === 'decision' ? colDecision : null;
      attachColumnResizer(th, colEls[i], linked);
    }
    headerRow.appendChild(th);
  });
  const thDecision = document.createElement('th');
  thDecision.textContent = 'Decision';
  attachColumnResizer(thDecision, colDecision);
  headerRow.appendChild(thDecision);
  thead.appendChild(headerRow);

  if (items.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = config.columns.length + 1;
    td.textContent = '(empty)';
    td.style.color = 'var(--sidebar-text)';
    td.style.textAlign = 'center';
    td.style.fontStyle = 'italic';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return table;
  }

  for (const row of items) {
    const tr = document.createElement('tr');
    for (const col of config.columns) {
      const td = document.createElement('td');
      const v = col.get(row);
      td.textContent = v === null || v === undefined ? '' : String(v);
      tr.appendChild(td);
    }
    tr.appendChild(createDecisionCell(row));
    tbody.appendChild(tr);
  }

  return table;
}

async function refreshFolder() {
  try {
    fileTree = await buildRootTreeFromServer();
    renderTree(fileTree.children, document.getElementById('sidebar'));
    // Re-open current file if still open
    if (currentFilePath) {
      try {
        const { text: md, mtime } = await readFile(currentFilePath);
        currentFileMtime = mtime;
        currentMarkdown = md;
        showPreview(md);
        showToast('Refreshed');
      } catch {
        // File may have been deleted
        currentFilePath = null;
        currentFileMtime = null;
        document.getElementById('content-toolbar').classList.remove('visible');
        const _g = document.getElementById('md-line-gutter');
        const _c = document.getElementById('md-preview-content');
        if (_g) _g.innerHTML = '';
        if (_c) _c.innerHTML = '';
        showToast('Refreshed (current file no longer available)');
      }
    } else {
      showToast('Refreshed');
    }
  } catch (err) {
    showToast('Refresh failed: ' + err.message);
  }
}

document.getElementById('btn-refresh').addEventListener('click', refreshFolder);

// ============================================================
// Basic Markdown Parser (for view mode)
// ============================================================
let lastMermaidBlocks = []; // store raw mermaid source for rendering

function mergeConsecutiveBlockquotes(htmlStr) {
  const lines = htmlStr.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^&gt;\s?/.test(line)) {
      const qLines = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) {
        qLines.push(lines[i].replace(/^&gt;\s?/, ''));
        i++;
      }
      const firstRaw = qLines[0] || '';
      const isWarning = /\[!\s*WARNING\s*\]/i.test(firstRaw);
      const processed = qLines.map((l, idx) => {
        if (idx === 0 && isWarning) {
          return l.replace(/\[!\s*WARNING\s*\]/gi, '').replace(/^\s+|\s+$/g, '');
        }
        return l;
      });
      const inner = processed.join('<br>');
      const cls = isWarning ? ' class="blockquote-warning"' : '';
      out.push(`<blockquote${cls}>${inner}</blockquote>`);
    } else {
      out.push(line);
      i++;
    }
  }
  return out.join('\n');
}

function renderDiffLines(code) {
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = code.replace(/\n$/, '').split('\n');
  return lines.map(line => {
    let cls;
    if (line.startsWith('@@')) cls = 'diff-hunk';
    else if (line.startsWith('+')) cls = 'diff-add';
    else if (line.startsWith('-')) cls = 'diff-del';
    else cls = 'diff-ctx';
    return `<span class="diff-line ${cls}">${escape(line) || '&#8203;'}</span>`;
  }).join('');
}

function parseMarkdown(md) {
  const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Extract mermaid blocks BEFORE any processing to protect them
  const mermaidBlocks = [];
  let html = md.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
    const placeholder = `%%MERMAID_${mermaidBlocks.length}%%`;
    mermaidBlocks.push(code.trim());
    return placeholder;
  });
  lastMermaidBlocks = mermaidBlocks;

  // Extract fenced code blocks from RAW markdown (before HTML preservation) so
  // HTML-looking text inside code stays literal and never becomes a real tag.
  const codeBlocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `%%CODEBLOCK_${codeBlocks.length}%%`;
    if (lang === 'diff') {
      codeBlocks.push(`<pre class="diff-block"><code>${renderDiffLines(code)}</code></pre>`);
    } else {
      codeBlocks.push(`<pre><code>${escapeText(code.trim())}</code></pre>`);
    }
    return placeholder;
  });

  // Extract inline code from RAW markdown for the same reason.
  const inlineCodes = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const placeholder = `%%INLINECODE_${inlineCodes.length}%%`;
    inlineCodes.push(`<code>${escapeText(code)}</code>`);
    return placeholder;
  });

  // HTML comments → visible blocks (existing feature: show comments as text in preview)
  const htmlComments = [];
  html = html.replace(/<!--([\s\S]*?)-->/g, (_, content) => {
    const placeholder = `%%HTMLCOMMENT_${htmlComments.length}%%`;
    htmlComments.push(`<div class="html-comment-block">&lt;!--${escapeText(content)}--&gt;</div>`);
    return placeholder;
  });

  // Preserve all HTML tags (opening, closing, self-closing) before escaping.
  // This is what lets <br>, <span>, <details>, <kbd>, <sub>, etc. render as HTML
  // instead of being escaped into literal text. Tag name must be [a-zA-Z][a-zA-Z0-9-]*
  // so autolinks like <https://example.com> and prose like "a<b<c" don't match.
  const htmlTags = [];
  html = html.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?\/?>/g, (tag) => {
    const placeholder = `%%HTMLTAG_${htmlTags.length}%%`;
    htmlTags.push(tag);
    return placeholder;
  });

  // Escape remaining stray < > & (user's literal text, no real tags left at this point)
  html = escapeText(html);

  // Headings (with id for outline navigation)
  let headingCounter = 0;
  const headingReplacer = (level) => (_, text) => {
    const id = 'heading-' + (headingCounter++);
    return `<h${level} id="${id}">${text}</h${level}>`;
  };
  html = html.replace(/^######\s+(.+)$/gm, headingReplacer(6));
  html = html.replace(/^#####\s+(.+)$/gm, headingReplacer(5));
  html = html.replace(/^####\s+(.+)$/gm, headingReplacer(4));
  html = html.replace(/^###\s+(.+)$/gm, headingReplacer(3));
  html = html.replace(/^##\s+(.+)$/gm, headingReplacer(2));
  html = html.replace(/^#\s+(.+)$/gm, headingReplacer(1));

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>');

  // Bold & italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');

  // Links (external get target="_blank", internal stay in-app)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    if (/^https?:\/\//.test(url) || url.startsWith('mailto:')) {
      return `<a href="${url}" target="_blank">${text}</a>`;
    }
    return `<a href="${url}">${text}</a>`;
  });

  // Blockquotes: merge consecutive &gt; lines into one block; [!WARNING] on first line → warning style
  html = mergeConsecutiveBlockquotes(html);

  // Unordered lists
  html = html.replace(/^[\-\*]\s+(.+)$/gm, '<uli>$1</uli>');

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<oli>$1</oli>');

  // Wrap consecutive list items
  html = html.replace(/(<uli>.*<\/uli>\n?)+/g, (m) => '<ul>' + m.replace(/<\/?uli>/g, (t) => t.replace('uli', 'li')) + '</ul>');
  html = html.replace(/(<oli>.*<\/oli>\n?)+/g, (m) => '<ol>' + m.replace(/<\/?oli>/g, (t) => t.replace('oli', 'li')) + '</ol>');

  // Tables
  html = html.replace(/^(\|.+\|)\n(\|[\s\-:|]+\|)\n((?:\|.+\|\n?)+)/gm, (_, headerRow, sepRow, bodyRows) => {
    const parseRow = (row) => row.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const headers = parseRow(headerRow);
    // Parse alignment from separator row
    const aligns = parseRow(sepRow).map(c => {
      if (c.startsWith(':') && c.endsWith(':')) return 'center';
      if (c.endsWith(':')) return 'right';
      return 'left';
    });
    let table = '<table><thead><tr>';
    headers.forEach((h, i) => {
      table += `<th style="text-align:${aligns[i] || 'left'}">${h}</th>`;
    });
    table += '</tr></thead><tbody>';
    bodyRows.trim().split('\n').forEach(row => {
      const cells = parseRow(row);
      table += '<tr>';
      cells.forEach((c, i) => {
        table += `<td style="text-align:${aligns[i] || 'left'}">${c}</td>`;
      });
      table += '</tr>';
    });
    table += '</tbody></table>';
    return table;
  });

  // Paragraphs: wrap remaining lines. Skip lines starting with a tag or with
  // any preserved-HTML placeholder so block-level HTML (<details>, <div>…) and
  // standalone code/comment blocks don't get wrapped in <p>.
  html = html.replace(/^(?!<[a-z])(?!%%(?:HTMLTAG|HTMLCOMMENT|CODEBLOCK|MERMAID)_)((?!^\s*$).+)$/gm, '<p>$1</p>');

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

  // Restore inline code (can appear anywhere, including inside other tags)
  inlineCodes.forEach((code, i) => {
    html = html.replace(`%%INLINECODE_${i}%%`, code);
  });

  // Restore HTML comments as visible blocks
  htmlComments.forEach((div, i) => {
    html = html.replace(`<p>%%HTMLCOMMENT_${i}%%</p>`, div);
    html = html.replace(`%%HTMLCOMMENT_${i}%%`, div);
  });

  // Restore HTML tags (covers <img>, <br>, <span>, <details>, <kbd>, etc.)
  htmlTags.forEach((tag, i) => {
    html = html.replace(`%%HTMLTAG_${i}%%`, tag);
  });

  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    html = html.replace(`<p>%%CODEBLOCK_${i}%%</p>`, block);
    html = html.replace(`%%CODEBLOCK_${i}%%`, block);
  });

  // Restore mermaid blocks — content is empty; mermaid.render() in showPreview() uses raw source directly
  mermaidBlocks.forEach((code, i) => {
    const wrapped = `<div class="mermaid-wrapper" data-mermaid-idx="${i}"><div class="mermaid-controls"><button class="mermaid-zoom-out" title="Smaller">A-</button><span class="mermaid-size-label">100%</span><button class="mermaid-zoom-in" title="Larger">A+</button><span class="mermaid-spacer"></span><button class="mermaid-fullscreen" title="Fullscreen">⛶</button></div><div class="mermaid"></div></div>`;
    html = html.replace(`<p>%%MERMAID_${i}%%</p>`, wrapped);
    html = html.replace(`%%MERMAID_${i}%%`, wrapped);
  });

  return html;
}

// ============================================================
// Markdown preview DOM (scroll host + content + line gutter)
// ============================================================
function getMdScrollHost() {
  return document.getElementById('markdown-preview');
}

function getMdPreviewContent() {
  return document.getElementById('md-preview-content');
}

function elOffsetTopInScrollHost(el, scrollHost) {
  return el.getBoundingClientRect().top - scrollHost.getBoundingClientRect().top + scrollHost.scrollTop;
}

function buildMdLineGutter(markdownSource) {
  const gutter = document.getElementById('md-line-gutter');
  if (!gutter) return;
  if (markdownSource == null || !String(markdownSource).trim()) {
    gutter.innerHTML = '';
    return;
  }
  const lineCount = String(markdownSource).split('\n').length;
  gutter.innerHTML = Array.from({ length: lineCount }, (_, i) =>
    `<span class="md-line-num">${i + 1}</span>`).join('');
}

function syncMdLineGutterLayout() {
  const gutter = document.getElementById('md-line-gutter');
  const content = getMdPreviewContent();
  const scrollHost = getMdScrollHost();
  if (!gutter || !content || !scrollHost) return;
  const nums = gutter.querySelectorAll('.md-line-num');
  const n = nums.length;
  if (n === 0) {
    gutter.style.minHeight = '';
    return;
  }
  const sh = Math.max(content.scrollHeight, 1);
  gutter.style.minHeight = sh + 'px';
  const rowH = sh / n;
  nums.forEach((el) => {
    el.style.height = rowH + 'px';
    el.style.lineHeight = rowH + 'px';
  });
}

let _mdGutterResizeObserver = null;
function ensureMdGutterResizeObserver() {
  const content = getMdPreviewContent();
  if (!content || _mdGutterResizeObserver) return;
  _mdGutterResizeObserver = new ResizeObserver(() => {
    syncMdLineGutterLayout();
  });
  _mdGutterResizeObserver.observe(content);
}

// ============================================================
// File Selection + Preview
// ============================================================
async function selectFile(entry, resolvedPath) {
  try {
    const path = resolvedPath || getFilePath(entry, fileTree.children);
    const { text, mtime } = await readFile(path);

    if (entry.name.endsWith('.json')) {
      if (jsonDirty && !confirm('放弃未保存的修改？')) return;
      let raw;
      try {
        raw = JSON.parse(text);
      } catch (parseErr) {
        showToast('Invalid JSON: ' + parseErr.message);
        return;
      }
      const { payload, history, wasArrayEnvelope } = unwrapOnLoad(raw);
      currentJsonData = payload;
      currentJsonFilePath = path;
      currentJsonHistory = history;
      jsonWasArrayEnvelope = wasArrayEnvelope;
      jsonOriginalSnapshot = deepClonePayload(payload);
      jsonDirty = false;
      showJsonTable(entry.name, payload);
      return;
    }

    currentFilePath = path;
    currentFileMtime = mtime;
    currentMarkdown = text;

    document.getElementById('content-toolbar').classList.add('visible');
    document.getElementById('file-name').textContent = entry.name;

    showPreview(text);
  } catch (err) {
    showToast('Failed to read file: ' + err.message);
  }
}

async function showPreview(md) {
  const scrollHost = getMdScrollHost();
  const previewContent = getMdPreviewContent();
  const contentBody = document.querySelector('.content-body');
  const outlineList = document.getElementById('outline-list');

  removeActivePopup();
  removeActiveTooltip();
  document.body.classList.remove('json-view');
  revokeActiveBlobUrls();
  if (!scrollHost || !previewContent) return;
  ensureMdGutterResizeObserver();

  if (!md.trim()) {
    const gutter = document.getElementById('md-line-gutter');
    if (gutter) gutter.innerHTML = '';
    previewContent.innerHTML = '<p style="color: var(--sidebar-text); font-style: italic;">This file is empty.</p>';
    outlineList.innerHTML = '';
    currentFileNotes = [];
    requestAnimationFrame(() => syncMdLineGutterLayout());
  } else {
    buildMdLineGutter(md);
    previewContent.innerHTML = parseMarkdown(md);
    // Render mermaid diagrams using raw source text
    const mermaidEls = previewContent.querySelectorAll('.mermaid');
    if (mermaidEls.length > 0 && mermaid) {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'default', fontSize: 12, themeVariables: { fontSize: '12px' } });
      for (let i = 0; i < mermaidEls.length; i++) {
        try {
          const raw = lastMermaidBlocks[i];
          if (!raw) continue;
          const { svg } = await mermaid.render('mermaid-svg-' + i, raw);
          mermaidEls[i].innerHTML = svg;
        } catch (err) {
          mermaidEls[i].innerHTML = '<pre style="color:red;text-align:left;font-size:0.85rem;">Mermaid error: ' + err.message + '</pre>';
        }
      }
    }
    // Wire mermaid zoom controls
    initMermaidZoom(previewContent);
    // Resolve relative image paths to blob URLs
    await resolvePreviewImages(previewContent);

    // Build outline
    buildOutline(scrollHost, previewContent, outlineList);

    // Restore sticky notes
    if (currentFilePath) {
      currentFileNotes = await loadNotesForFile(currentFilePath);
      if (currentFileNotes.length > 0) {
        const orphaned = restoreNotes(currentFileNotes);
        renderOrphanedNotes(orphaned);
      }
    }
    requestAnimationFrame(() => {
      syncMdLineGutterLayout();
      requestAnimationFrame(() => syncMdLineGutterLayout());
    });
  }
  contentBody.classList.add('visible');
  try {
    currentNoteIndex = -1;
    updateNoteNav();
    currentRiskIndex = -1;
    updateRiskNav();
  } catch(e) {}
}

// ============================================================
// Edit button — navigate to Edit.html
// ============================================================
let currentMarkdown = null;

// Back button — exit JSON view and return to folder/file view
document.getElementById('btn-save-json').addEventListener('click', () => {
  saveCurrentJson();
});

document.getElementById('btn-back').addEventListener('click', () => {
  if (jsonDirty && !confirm('放弃未保存的修改？')) return;
  document.body.classList.remove('json-view');
  currentJsonData = null;
  currentJsonFileHandle = null;
  currentJsonFilePath = null;
  currentJsonHistory = [];
  jsonWasArrayEnvelope = false;
  jsonOriginalSnapshot = null;
  jsonDirty = false;
  updateDirtyUi();
  revokeActiveBlobUrls();

  // Always have a directory in HTTP mode — reset content pane
  document.getElementById('content-toolbar').classList.remove('visible');
  document.querySelector('.content-body').classList.remove('visible');
  document.getElementById('md-preview-content').innerHTML = '';
  document.getElementById('outline-list').innerHTML = '';
  const gutter = document.getElementById('md-line-gutter');
  if (gutter) gutter.innerHTML = '';
});

document.getElementById('btn-edit').addEventListener('click', () => {
  if (!currentFilePath) return;
  // Store the file path so Edit.html knows which file to open
  sessionStorage.setItem('trio-edit-file', currentFilePath);
  // Save folder expand/collapse state before leaving
  sessionStorage.setItem('trio-folder-state', JSON.stringify(getExpandedFolderPaths()));
  window.location.href = 'Edit.html';
});

function initMermaidZoom(preview) {
  preview.querySelectorAll('.mermaid-wrapper').forEach(wrapper => {
    const mermaidDiv = wrapper.querySelector('.mermaid');
    const label = wrapper.querySelector('.mermaid-size-label');
    const btnOut = wrapper.querySelector('.mermaid-zoom-out');
    const btnIn = wrapper.querySelector('.mermaid-zoom-in');
    const btnFull = wrapper.querySelector('.mermaid-fullscreen');
    let scale = 100; // percentage
    let panX = 0;
    let panY = 0;

    function apply() {
      const svg = mermaidDiv.querySelector('svg');
      if (!svg) return;
      svg.style.transform = `translate(${panX}px, ${panY}px) scale(${scale / 100})`;
      svg.style.transformOrigin = 'center center';
      label.textContent = scale + '%';
    }

    btnIn.addEventListener('click', () => {
      scale = Math.min(400, scale + 10);
      apply();
    });
    btnOut.addEventListener('click', () => {
      scale = Math.max(20, scale - 10);
      apply();
    });

    // Fullscreen toggle
    if (btnFull) {
      btnFull.addEventListener('click', () => {
        if (document.fullscreenElement === wrapper) {
          document.exitFullscreen();
        } else if (wrapper.requestFullscreen) {
          wrapper.requestFullscreen().catch(() => {});
        }
      });
      wrapper.addEventListener('fullscreenchange', () => {
        const isFs = document.fullscreenElement === wrapper;
        btnFull.title = isFs ? 'Exit fullscreen' : 'Fullscreen';
      });
    }

    // Drag-to-pan
    let dragging = false;
    let startX = 0, startY = 0;
    let startPanX = 0, startPanY = 0;
    mermaidDiv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      mermaidDiv.classList.add('dragging');
      startX = e.clientX; startY = e.clientY;
      startPanX = panX; startPanY = panY;
      try { mermaidDiv.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    mermaidDiv.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      panX = startPanX + (e.clientX - startX);
      panY = startPanY + (e.clientY - startY);
      apply();
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      mermaidDiv.classList.remove('dragging');
      try { mermaidDiv.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    mermaidDiv.addEventListener('pointerup', endDrag);
    mermaidDiv.addEventListener('pointercancel', endDrag);

    // Double-click resets pan + scale
    mermaidDiv.addEventListener('dblclick', () => {
      scale = 100; panX = 0; panY = 0;
      apply();
    });
  });
}

let _outlineScrollHandler = null;
let _outlineScrollHost = null;

function buildOutline(scrollEl, contentEl, outlineList) {
  outlineList.innerHTML = '';
  // Remove previous scroll listener to prevent accumulation
  if (_outlineScrollHandler && _outlineScrollHost) {
    _outlineScrollHost.removeEventListener('scroll', _outlineScrollHandler);
    _outlineScrollHandler = null;
    _outlineScrollHost = null;
  }
  const headings = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (headings.length === 0) {
    outlineList.innerHTML = '<div style="padding: 8px 12px; color: var(--sidebar-text); font-style: italic;">No headings</div>';
    return;
  }
  headings.forEach(h => {
    const item = document.createElement('div');
    item.className = 'outline-item';
    item.setAttribute('data-level', h.tagName[1]);
    item.textContent = h.textContent;
    item.addEventListener('click', () => {
      h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    outlineList.appendChild(item);
  });

  // Highlight active heading on scroll
  let scrollTimeout;
  _outlineScrollHost = scrollEl;
  _outlineScrollHandler = () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => highlightActiveOutline(scrollEl, contentEl, outlineList), 50);
  };
  scrollEl.addEventListener('scroll', _outlineScrollHandler);
  highlightActiveOutline(scrollEl, contentEl, outlineList);
}

function highlightActiveOutline(scrollEl, contentEl, outlineList) {
  const headings = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
  const items = outlineList.querySelectorAll('.outline-item');
  if (headings.length === 0) return;

  let activeIndex = 0;
  const scrollTop = scrollEl.scrollTop;
  for (let i = 0; i < headings.length; i++) {
    const top = elOffsetTopInScrollHost(headings[i], scrollEl);
    if (top - 20 <= scrollTop) {
      activeIndex = i;
    }
  }
  items.forEach((item, i) => {
    item.classList.toggle('active', i === activeIndex);
  });
}

let currentFileNotes = [];

// ============================================================
// Sticky Notes — Floating Create Button
// ============================================================
const NOTE_COLORS = {
  yellow: { light: '#fef3cd', dark: '#5c5a3e', raw: '#f5c518' },
  pink:   { light: '#f8d7da', dark: '#5c3d40', raw: '#e85d75' },
  green:  { light: '#d4edda', dark: '#3d5c43', raw: '#51a66d' },
  blue:   { light: '#d1ecf1', dark: '#3d4f5c', raw: '#4da6c9' },
  purple: { light: '#e2d9f3', dark: '#4a3d5c', raw: '#8b6fc0' },
};

// Track whether we're creating a note (to prevent dismiss-on-mousedown from interfering)
let _creatingNote = false;
let _selectionToolbar = null;

function hideSelectionToolbar() {
  if (_selectionToolbar) { _selectionToolbar.remove(); _selectionToolbar = null; }
}

// Stash selection context so the "+" handler can use it
let _selCtx = null;

document.getElementById('markdown-preview').addEventListener('mouseup', (e) => {
  if (_creatingNote) return;
  setTimeout(() => {
    if (_creatingNote) return;
    hideSelectionToolbar();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const preview = getMdPreviewContent();
    if (!preview || !preview.contains(range.commonAncestorContainer)) return;

    // Don't show if selection is inside an existing highlight
    const ancestor = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;
    if (ancestor.closest('.note-highlight')) return;

    const selectedText = range.toString();
    if (!selectedText.trim()) return;

    // Position at end of selection (viewport rects)
    const rects = range.getClientRects();
    const lastRect = rects[rects.length - 1];
    if (!lastRect) return;

    const contentBody = document.querySelector('.content-body');
    const bodyRect = contentBody.getBoundingClientRect();
    const bodyW = contentBody.clientWidth;
    const bodyH = contentBody.clientHeight;

    // Anchor point for new-note popup: selection end (used by positionPopupNear via zero-size span)
    const anchorLeft = lastRect.right - bodyRect.left;
    const anchorTop = lastRect.bottom - bodyRect.top + 4;

    // Save selection context
    _selCtx = {
      selectedText,
      startOffset: currentFilePath ? getTextOffset(getMdPreviewContent(), range.startContainer, range.startOffset) : 0,
      endOffset: 0,
      sectionId: currentFilePath ? findSectionId(range.startContainer) : null,
      anchorLeft,
      anchorTop,
    };
    _selCtx.endOffset = _selCtx.startOffset + selectedText.length;

    // Create mini toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'selection-toolbar';

    // Add note button
    if (currentFilePath) {
      const addBtn = document.createElement('button');
      addBtn.textContent = '+';
      addBtn.title = 'Add note';
      addBtn.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
      addBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const ctx = _selCtx;
        if (!ctx) return;
        hideSelectionToolbar();

        _creatingNote = true;
        const tempSpan = document.createElement('span');
        tempSpan.style.cssText = 'position:absolute;left:' + ctx.anchorLeft + 'px;top:' + ctx.anchorTop + 'px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;';
        contentBody.appendChild(tempSpan);
        _pendingTempSpan = tempSpan;

        createPopup({
          note: { color: 'yellow' },
          anchorEl: tempSpan,
          isNew: true,
          onSave: async ({ content, color, width, height }) => {
            if (tempSpan.parentNode) tempSpan.remove();
            _pendingTempSpan = null;
            _creatingNote = false;
            window.getSelection().removeAllRanges();

            const noteId = generateNoteId();
            const noteData = {
              id: noteId,
              filePath: currentFilePath,
              selectedText: ctx.selectedText,
              sectionId: ctx.sectionId,
              startOffset: ctx.startOffset,
              endOffset: ctx.endOffset,
              content,
              color,
              width,
              height,
              createdAt: Date.now(),
            };

            await saveNote(noteData);
            applyHighlight(noteData);
            currentFileNotes.push(noteData);
            updateNoteNav();
          },
          onDelete: null,
        });
      });
      toolbar.appendChild(addBtn);
    }

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '📋';
    copyBtn.title = 'Copy';
    copyBtn.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
    });
    copyBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      navigator.clipboard.writeText(selectedText).then(() => {
        showToast('Copied!');
      });
      hideSelectionToolbar();
      window.getSelection().removeAllRanges();
    });
    toolbar.appendChild(copyBtn);

    contentBody.appendChild(toolbar);
    _selectionToolbar = toolbar;

    // Place toolbar after layout so we can measure; keep inside content-body and viewport
    const tPad = 8;
    const tGap = 4;
    const tw = toolbar.offsetWidth || 1;
    const th = toolbar.offsetHeight || 1;
    const selMidX = (lastRect.left + lastRect.right) / 2;
    const bodyMidX = bodyRect.left + bodyW / 2;
    let toolLeft = lastRect.right - bodyRect.left;
    if (selMidX > bodyMidX) {
      toolLeft = lastRect.right - bodyRect.left - tw;
    }
    toolLeft = Math.max(tPad, Math.min(toolLeft, bodyW - tw - tPad));
    let toolTop = lastRect.bottom - bodyRect.top + tGap;
    if (toolTop + th > bodyH - tPad) {
      toolTop = lastRect.top - bodyRect.top - th - tGap;
    }
    toolTop = Math.max(tPad, Math.min(toolTop, bodyH - th - tPad));
    toolbar.style.left = toolLeft + 'px';
    toolbar.style.top = toolTop + 'px';

    // Nudge into viewport if content-body extends past window (zoom / small window)
    for (let i = 0; i < 3; i++) {
      const tr = toolbar.getBoundingClientRect();
      let dTop = 0;
      let dLeft = 0;
      if (tr.bottom > window.innerHeight - tPad) dTop = window.innerHeight - tPad - tr.bottom;
      if (tr.top < tPad) dTop = tPad - tr.top;
      if (tr.right > window.innerWidth - tPad) dLeft = window.innerWidth - tPad - tr.right;
      if (tr.left < tPad) dLeft = tPad - tr.left;
      if (!dTop && !dLeft) break;
      toolTop += dTop;
      toolLeft += dLeft;
      toolTop = Math.max(tPad, Math.min(toolTop, bodyH - th - tPad));
      toolLeft = Math.max(tPad, Math.min(toolLeft, bodyW - tw - tPad));
      toolbar.style.left = toolLeft + 'px';
      toolbar.style.top = toolTop + 'px';
    }
  }, 10);
});

// Hide toolbar on click outside
document.addEventListener('mousedown', (e) => {
  if (_selectionToolbar && !_selectionToolbar.contains(e.target)) {
    hideSelectionToolbar();
  }
});

// ============================================================
// Sticky Notes — Offset & Section Helpers
// ============================================================
function getTextOffset(container, targetNode, targetOffset) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === targetNode) return offset + targetOffset;
    offset += walker.currentNode.textContent.length;
  }
  return offset;
}

function findSectionId(node) {
  const root = getMdPreviewContent();
  if (!root) return null;
  const headings = root.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]');
  let lastId = null;
  const nodeEl = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const nodeTop = nodeEl.getBoundingClientRect().top;
  for (const h of headings) {
    if (h.getBoundingClientRect().top <= nodeTop) lastId = h.id;
  }
  return lastId;
}

function generateNoteId() {
  return 'note-' + crypto.randomUUID();
}

// ============================================================
// Sticky Notes — Create / Edit Popup
// ============================================================
let activePopup = null;
let activeTooltip = null;
let _pendingTempSpan = null;
let _activeRecognition = null;

function removeActivePopup(keepPendingSpan = null) {
  if (_activeRecognition) { try { _activeRecognition.stop(); } catch(e) {} _activeRecognition = null; }
  if (_pendingTempSpan && _pendingTempSpan !== keepPendingSpan && _pendingTempSpan.parentNode) {
    _pendingTempSpan.remove();
    _pendingTempSpan = null;
  }
  if (activePopup) { activePopup.remove(); activePopup = null; }
  try {
    _creatingNote = false;
    window.getSelection().removeAllRanges();
  } catch(e) {}
}

function removeActiveTooltip() {
  if (activeTooltip) { activeTooltip.remove(); activeTooltip = null; }
}

function getRawColor(colorName) {
  return NOTE_COLORS[colorName]?.raw || NOTE_COLORS.yellow.raw;
}

function getNoteColor(colorName) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const c = NOTE_COLORS[colorName] || NOTE_COLORS.yellow;
  return isDark ? c.dark : c.light;
}

function positionPopupNear(popup, anchorEl) {
  // Position relative to content-body (position: relative; popup is absolute child)
  const contentBody = document.querySelector('.content-body');
  if (!contentBody) return;

  const bodyRect = contentBody.getBoundingClientRect();
  const anchorRect = anchorEl.getBoundingClientRect();
  const pad = 8;
  const gap = 6;
  const vp = 8;

  const w = popup.offsetWidth;
  const h = popup.offsetHeight;
  const bodyW = contentBody.clientWidth;
  const bodyH = contentBody.clientHeight;

  const maxLeft = Math.max(pad, bodyW - w - pad);
  const maxTop = Math.max(pad, bodyH - h - pad);

  // Horizontal: default to anchor left; if anchor sits in the right half of the pane, align popup right edge to anchor
  let left = anchorRect.left - bodyRect.left;
  const anchorMidX = (anchorRect.left + anchorRect.right) / 2;
  const bodyMidX = bodyRect.left + bodyW / 2;
  if (anchorMidX > bodyMidX) {
    left = anchorRect.right - bodyRect.left - w;
  }
  left = Math.max(pad, Math.min(left, maxLeft));

  // Vertical: prefer below anchor; if it would leave the content pane, try above; then clamp
  let top = anchorRect.bottom - bodyRect.top + gap;
  if (top > maxTop) {
    const aboveTop = anchorRect.top - bodyRect.top - h - gap;
    if (aboveTop >= pad) {
      top = aboveTop;
    } else {
      top = Math.min(top, maxTop);
    }
  }
  top = Math.max(pad, Math.min(top, maxTop));

  popup.style.top = top + 'px';
  popup.style.left = left + 'px';

  // Keep fully inside the browser viewport (handles small windows / zoom / rounding)
  for (let i = 0; i < 4; i++) {
    const pr = popup.getBoundingClientRect();
    let dTop = 0;
    let dLeft = 0;
    if (pr.bottom > window.innerHeight - vp) dTop = window.innerHeight - vp - pr.bottom;
    if (pr.top < vp) dTop = vp - pr.top;
    if (pr.right > window.innerWidth - vp) dLeft = window.innerWidth - vp - pr.right;
    if (pr.left < vp) dLeft = vp - pr.left;
    if (!dTop && !dLeft) break;
    top += dTop;
    left += dLeft;
    top = Math.max(pad, Math.min(top, maxTop));
    left = Math.max(pad, Math.min(left, maxLeft));
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
  }
}

function createPopup({ note, anchorEl, isNew, onSave, onDelete }) {
  removeActivePopup(anchorEl);
  removeActiveTooltip();

  const popup = document.createElement('div');
  popup.className = 'note-popup';
  if (isNew) {
    popup.style.width = '400px';
    popup.style.height = '200px';
  } else {
    if (note.width) popup.style.width = note.width + 'px';
    if (note.height) popup.style.height = note.height + 'px';
  }

  let currentColor = note?.color || 'yellow';
  popup.style.background = getNoteColor(currentColor);

  const body = document.createElement('div');
  body.className = 'note-popup-body';

  const picker = document.createElement('div');
  picker.className = 'note-color-picker';
  for (const [name] of Object.entries(NOTE_COLORS)) {
    const dot = document.createElement('button');
    dot.className = 'note-color-dot' + (name === currentColor ? ' selected' : '');
    dot.style.background = getNoteColor(name);
    dot.title = name;
    dot.addEventListener('click', () => {
      currentColor = name;
      picker.querySelectorAll('.note-color-dot').forEach(d => d.classList.remove('selected'));
      dot.classList.add('selected');
      popup.style.background = getNoteColor(name);
    });
    picker.appendChild(dot);
  }

  const textarea = document.createElement('textarea');
  textarea.value = note?.content || '';
  textarea.placeholder = 'Write a note...';
  const NOTE_POPUP_CHROME_H = 108;
  if (!isNew && note.width && note.height) {
    textarea.style.width = '100%';
    textarea.style.height = Math.max(48, note.height - NOTE_POPUP_CHROME_H) + 'px';
  }

  const actions = document.createElement('div');
  actions.className = 'note-popup-actions';

  if (!isNew && onDelete) {
    const delBtn = document.createElement('button');
    delBtn.className = 'note-delete-btn';
    delBtn.textContent = '🗑';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', () => { onDelete(); removeActivePopup(); });
    actions.appendChild(delBtn);
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '✕';
  cancelBtn.title = 'Cancel';
  cancelBtn.addEventListener('click', removeActivePopup);

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '✓';
  saveBtn.title = isNew ? 'Add' : 'Save';
  saveBtn.style.color = 'var(--accent)';
  saveBtn.addEventListener('click', () => {
    const w = popup.offsetWidth;
    const h = popup.offsetHeight;
    onSave({ content: textarea.value, color: currentColor, width: w, height: h });
    removeActivePopup();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(saveBtn);

  body.appendChild(picker);
  body.appendChild(textarea);
  body.appendChild(actions);
  popup.appendChild(body);

  // Resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'note-popup-resize';
  popup.appendChild(resizeHandle);

  let isResizing = false;
  let resizeStartX, resizeStartY, resizeStartW, resizeStartH;

  resizeHandle.addEventListener('mousedown', (re) => {
    re.preventDefault();
    re.stopPropagation();
    isResizing = true;
    resizeStartX = re.clientX;
    resizeStartY = re.clientY;
    resizeStartW = popup.offsetWidth;
    resizeStartH = popup.offsetHeight;
    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';

    function onMove(me) {
      if (!isResizing) return;
      const newW = Math.max(400, resizeStartW + (me.clientX - resizeStartX));
      const newH = Math.max(200, resizeStartH + (me.clientY - resizeStartY));
      popup.style.width = newW + 'px';
      popup.style.height = newH + 'px';
    }
    function onUp() {
      isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  const contentBody = document.querySelector('.content-body');
  popup.style.position = 'absolute';
  contentBody.appendChild(popup);
  positionPopupNear(popup, anchorEl);
  activePopup = popup;
  popup._anchorEl = anchorEl;
  requestAnimationFrame(() => {
    if (activePopup === popup && document.body.contains(anchorEl)) {
      positionPopupNear(popup, anchorEl);
    }
  });

  // Only auto-focus textarea for edit (not new), to preserve text selection
  if (!isNew) textarea.focus();
}

// (Float button removed — popup opens directly on text selection)

// ============================================================
// Sticky Notes — Highlight Wrapping
// ============================================================
function applyHighlight(note) {
  const preview = getMdPreviewContent();
  if (!preview) return;
  const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  const nodesToWrap = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const nodeLen = node.textContent.length;
    const nodeStart = currentOffset;
    const nodeEnd = currentOffset + nodeLen;

    if (nodeEnd > note.startOffset && nodeStart < note.endOffset) {
      const wrapStart = Math.max(0, note.startOffset - nodeStart);
      const wrapEnd = Math.min(nodeLen, note.endOffset - nodeStart);
      nodesToWrap.push({ node, wrapStart, wrapEnd });
    }

    currentOffset = nodeEnd;
    if (currentOffset >= note.endOffset) break;
  }

  for (const { node, wrapStart, wrapEnd } of nodesToWrap) {
    const text = node.textContent;
    const before = text.slice(0, wrapStart);
    const middle = text.slice(wrapStart, wrapEnd);
    const after = text.slice(wrapEnd);

    const mark = document.createElement('mark');
    mark.className = 'note-highlight';
    mark.setAttribute('data-note-id', note.id);
    mark.setAttribute('data-color', note.color);
    mark.textContent = middle;

    const parent = node.parentNode;
    if (after) parent.insertBefore(document.createTextNode(after), node.nextSibling);
    parent.insertBefore(mark, node.nextSibling);
    if (before) {
      node.textContent = before;
    } else {
      parent.removeChild(node);
    }
  }
}

function removeHighlight(noteId) {
  const marks = document.querySelectorAll(`.note-highlight[data-note-id="${noteId}"]`);
  marks.forEach(mark => {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

// ============================================================
// Sticky Notes — Tooltip (hover) and Edit (click)
// ============================================================
function findNoteById(noteId) {
  return currentFileNotes.find(n => n.id === noteId);
}

function showTooltipForNote(markEl) {
  removeActiveTooltip();
  const noteId = markEl.getAttribute('data-note-id');
  const note = findNoteById(noteId);
  if (!note || !note.content) return;

  const tooltip = document.createElement('div');
  tooltip.className = 'note-tooltip';
  tooltip.style.background = getNoteColor(note.color);

  const content = document.createElement('div');
  content.className = 'note-tooltip-content';
  content.textContent = note.content;

  tooltip.appendChild(content);

  const contentBody = document.querySelector('.content-body');
  tooltip.style.position = 'absolute';
  contentBody.appendChild(tooltip);
  positionPopupNear(tooltip, markEl);
  activeTooltip = tooltip;
  tooltip._anchorEl = markEl;
}

// Event delegation on markdown-preview
const previewElForNotes = document.getElementById('markdown-preview');

previewElForNotes.addEventListener('scroll', () => {
  try {
    if (activePopup && activePopup._anchorEl && document.body.contains(activePopup._anchorEl)) {
      positionPopupNear(activePopup, activePopup._anchorEl);
    }
    if (activeTooltip && activeTooltip._anchorEl && document.body.contains(activeTooltip._anchorEl)) {
      positionPopupNear(activeTooltip, activeTooltip._anchorEl);
    }
  } catch (e) { /* ignore */ }
}, { passive: true });

previewElForNotes.addEventListener('mouseover', (e) => {
  const mark = e.target.closest('.note-highlight');
  if (mark && !activePopup) showTooltipForNote(mark);
});

previewElForNotes.addEventListener('mouseout', (e) => {
  const mark = e.target.closest('.note-highlight');
  if (mark) removeActiveTooltip();
});

previewElForNotes.addEventListener('click', (e) => {
  const mark = e.target.closest('.note-highlight');
  if (!mark) return;

  e.stopPropagation();
  const noteId = mark.getAttribute('data-note-id');
  const note = findNoteById(noteId);
  if (!note) return;

  createPopup({
    note,
    anchorEl: mark,
    isNew: false,
    onSave: async ({ content, color, width, height }) => {
      note.content = content;
      note.color = color;
      note.width = width;
      note.height = height;
      await saveNote(note);

      // Update highlight color
      const marks = document.querySelectorAll(`.note-highlight[data-note-id="${noteId}"]`);
      marks.forEach(m => m.setAttribute('data-color', color));
    },
    onDelete: async () => {
      removeHighlight(noteId);
      await deleteNoteById(noteId);
      currentFileNotes = currentFileNotes.filter(n => n.id !== noteId);
      updateNoteNav();
    },
  });
});

// ============================================================
// Internal Link Navigation
// ============================================================
function findEntryByPath(entries, pathParts) {
  if (!entries || pathParts.length === 0) return null;
  const [first, ...rest] = pathParts;
  for (const e of entries) {
    if (e.name === first) {
      if (rest.length === 0) return e;
      if (e.kind === 'directory' && e.children) return findEntryByPath(e.children, rest);
    }
  }
  return null;
}

document.getElementById('markdown-preview').addEventListener('click', (e) => {
  const anchor = e.target.closest('a');
  if (!anchor) return;
  const href = anchor.getAttribute('href');
  if (!href) return;

  // External links — let browser handle
  if (/^https?:\/\//.test(href) || href.startsWith('mailto:')) return;

  // Internal .md link — navigate within wiki
  e.preventDefault();
  e.stopPropagation();

  if (!currentFilePath) return;

  // Resolve relative path from current file's directory
  const currentDir = currentFilePath.includes('/') ? currentFilePath.replace(/\/[^/]+$/, '') : '';
  const parts = (currentDir ? currentDir + '/' + href : href).split('/');
  // Normalize . and ..
  const resolved = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') { resolved.pop(); continue; }
    resolved.push(p);
  }

  const resolvedPath = resolved.join('/');
  const entry = fileTree ? findEntryByPath(fileTree.children, resolved) : null;
  if (entry && entry.kind === 'file') {
    selectFile(entry, resolvedPath);
    // Update sidebar highlight
    document.querySelectorAll('.tree-item.selected').forEach(el => el.classList.remove('selected'));
  } else {
    showToast('File not found: ' + resolved.join('/'));
  }
});

// ============================================================
// Sticky Notes — Highlight Restoration
// ============================================================
function restoreNotes(notes) {
  const preview = getMdPreviewContent();
  if (!preview) return [];
  const fullText = preview.textContent;
  const orphaned = [];

  for (const note of notes) {
    let matchStart = -1;

    // Level 1: offset match
    const slice = fullText.slice(note.startOffset, note.endOffset);
    if (slice === note.selectedText) {
      matchStart = note.startOffset;
    }

    // Level 2: section search
    if (matchStart === -1 && note.sectionId) {
      const heading = document.getElementById(note.sectionId);
      if (heading) {
        const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
        let offset = 0;
        let headingOffset = -1;
        let nextHeadingOffset = -1;
        let passedHeading = false;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!passedHeading && heading.contains(node)) {
            headingOffset = offset;
            passedHeading = true;
          } else if (passedHeading && nextHeadingOffset === -1) {
            const parentEl = node.parentElement;
            if (parentEl && /^H[1-6]$/.test(parentEl.tagName) && parentEl !== heading) {
              nextHeadingOffset = offset;
              break;
            }
          }
          offset += node.textContent.length;
        }
        if (nextHeadingOffset === -1) nextHeadingOffset = fullText.length;

        if (headingOffset !== -1) {
          const sectionSlice = fullText.slice(headingOffset, nextHeadingOffset);
          const idx = sectionSlice.indexOf(note.selectedText);
          if (idx !== -1) {
            matchStart = headingOffset + idx;
          }
        }
      }
    }

    // Level 3: full-text search
    if (matchStart === -1) {
      const idx = fullText.indexOf(note.selectedText);
      if (idx !== -1) matchStart = idx;
    }

    if (matchStart !== -1) {
      note.startOffset = matchStart;
      note.endOffset = matchStart + note.selectedText.length;
      applyHighlight(note);
      // Persist updated offsets so future loads hit Level 1 directly
      saveNote(note).catch(e => console.warn('Failed to persist note offsets:', e));
    } else {
      orphaned.push(note);
    }
  }

  return orphaned;
}

function renderOrphanedNotes(orphaned) {
  if (orphaned.length === 0) return;

  const preview = getMdPreviewContent();
  if (!preview) return;
  const section = document.createElement('div');
  section.className = 'orphaned-notes-section';

  const title = document.createElement('div');
  title.className = 'orphaned-notes-title';
  title.textContent = 'Orphaned Notes (' + orphaned.length + ')';
  section.appendChild(title);

  for (const note of orphaned) {
    const card = document.createElement('div');
    card.className = 'orphaned-note-card';
    card.style.background = getNoteColor(note.color);

    const body = document.createElement('div');
    body.className = 'orphaned-note-body';

    const textEl = document.createElement('div');
    textEl.className = 'orphaned-note-text';
    textEl.textContent = '"' + note.selectedText + '"';

    const contentEl = document.createElement('div');
    contentEl.className = 'orphaned-note-content';
    contentEl.textContent = note.content;

    body.appendChild(textEl);
    body.appendChild(contentEl);
    card.appendChild(body);

    card.addEventListener('click', () => {
      createPopup({
        note,
        anchorEl: card,
        isNew: false,
        onSave: async ({ content, color, width, height }) => {
          note.content = content;
          note.color = color;
          note.width = width;
          note.height = height;
          await saveNote(note);
          contentEl.textContent = content;
          card.style.background = getNoteColor(color);
        },
        onDelete: async () => {
          await deleteNoteById(note.id);
          currentFileNotes = currentFileNotes.filter(n => n.id !== note.id);
          card.remove();
          updateNoteNav();
          if (section.querySelectorAll('.orphaned-note-card').length === 0) {
            section.remove();
          }
        },
      });
    });

    section.appendChild(card);
  }

  preview.appendChild(section);
}


// ============================================================
// Sticky Notes — Global Cleanup
// ============================================================
document.addEventListener('mousedown', (e) => {
  if (activePopup && !activePopup.contains(e.target) && !e.target.closest('.note-highlight') && !e.target.closest('.orphaned-note-card')) {
    removeActivePopup();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!activePopup) return;
  const ta = activePopup.querySelector('textarea');
  if (ta && ta.value.trim() !== '') {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  e.preventDefault();
  removeActivePopup();
}, true);

// ============================================================
// Risk navigation — [!WARNING] blockquotes (blockquote-warning)
// ============================================================
let currentRiskIndex = -1;

function getWarningBlockquotes() {
  const preview = getMdPreviewContent();
  if (!preview) return [];
  return Array.from(preview.querySelectorAll('blockquote.blockquote-warning'));
}

function updateRiskNav() {
  const blocks = getWarningBlockquotes();
  const total = blocks.length;
  const prevBtn = document.getElementById('btn-risk-prev');
  const nextBtn = document.getElementById('btn-risk-next');
  const label = document.getElementById('risk-nav-label');
  if (!prevBtn || !nextBtn || !label) return;

  if (total === 0) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    label.textContent = '';
    currentRiskIndex = -1;
    return;
  }

  if (currentRiskIndex >= total) currentRiskIndex = total - 1;

  if (currentRiskIndex < 0) {
    prevBtn.disabled = false;
    nextBtn.disabled = false;
    label.textContent = String(total);
  } else {
    prevBtn.disabled = currentRiskIndex <= 0;
    nextBtn.disabled = currentRiskIndex >= total - 1;
    label.textContent = `${currentRiskIndex + 1}/${total}`;
  }
}

function scrollToRisk(index) {
  const blocks = getWarningBlockquotes();
  if (index < 0 || index >= blocks.length) return;
  currentRiskIndex = index;
  const el = blocks[index];
  const preview = getMdScrollHost();
  if (!preview) return;
  const top = elOffsetTopInScrollHost(el, preview);
  const h = el.offsetHeight;
  const previewHeight = preview.clientHeight;
  preview.scrollTo({ top: top - (previewHeight / 2) + (h / 2), behavior: 'smooth' });

  el.style.outline = '2px solid #cf222e';
  el.style.outlineOffset = '2px';
  setTimeout(() => {
    el.style.outline = '';
    el.style.outlineOffset = '';
  }, 1200);

  updateRiskNav();
}

function findNearestRiskIndex() {
  const blocks = getWarningBlockquotes();
  if (blocks.length === 0) return -1;
  const preview = getMdScrollHost();
  if (!preview) return -1;
  const scrollCenter = preview.scrollTop + preview.clientHeight / 2;
  let closest = 0;
  let closestDist = Infinity;
  for (let i = 0; i < blocks.length; i++) {
    const center = elOffsetTopInScrollHost(blocks[i], preview) + blocks[i].offsetHeight / 2;
    const dist = Math.abs(center - scrollCenter);
    if (dist < closestDist) {
      closestDist = dist;
      closest = i;
    }
  }
  return closest;
}

document.getElementById('btn-risk-prev').addEventListener('click', () => {
  const blocks = getWarningBlockquotes();
  if (blocks.length === 0) return;
  if (currentRiskIndex < 0) currentRiskIndex = findNearestRiskIndex();
  const preview = getMdScrollHost();
  if (!preview) return;
  const scrollCenter = preview.scrollTop + preview.clientHeight / 2;
  let target = currentRiskIndex - 1;
  if (currentRiskIndex >= 0 && currentRiskIndex < blocks.length) {
    const curTop = elOffsetTopInScrollHost(blocks[currentRiskIndex], preview) + blocks[currentRiskIndex].offsetHeight / 2;
    if (Math.abs(curTop - scrollCenter) > 10) {
      target = -1;
      for (let i = blocks.length - 1; i >= 0; i--) {
        const c = elOffsetTopInScrollHost(blocks[i], preview) + blocks[i].offsetHeight / 2;
        if (c < scrollCenter - 10) {
          target = i;
          break;
        }
      }
    }
  }
  if (target < 0) return;
  scrollToRisk(target);
});

document.getElementById('btn-risk-next').addEventListener('click', () => {
  const blocks = getWarningBlockquotes();
  if (blocks.length === 0) return;
  if (currentRiskIndex < 0) currentRiskIndex = findNearestRiskIndex();
  const preview = getMdScrollHost();
  if (!preview) return;
  const scrollCenter = preview.scrollTop + preview.clientHeight / 2;
  let target = currentRiskIndex + 1;
  if (currentRiskIndex >= 0 && currentRiskIndex < blocks.length) {
    const curTop = elOffsetTopInScrollHost(blocks[currentRiskIndex], preview) + blocks[currentRiskIndex].offsetHeight / 2;
    if (Math.abs(curTop - scrollCenter) > 10) {
      target = blocks.length;
      for (let i = 0; i < blocks.length; i++) {
        const c = elOffsetTopInScrollHost(blocks[i], preview) + blocks[i].offsetHeight / 2;
        if (c > scrollCenter + 10) {
          target = i;
          break;
        }
      }
    }
  }
  if (target >= blocks.length) return;
  scrollToRisk(target);
});

// ============================================================
// Sticky Notes — Note Navigation (prev/next)
// ============================================================
let currentNoteIndex = -1;

function getOrderedHighlights() {
  const preview = getMdPreviewContent();
  if (!preview) return [];
  return Array.from(preview.querySelectorAll('.note-highlight[data-note-id]'))
    // Deduplicate by note id (a note may span multiple <mark> elements)
    .filter((el, i, arr) => arr.findIndex(e => e.getAttribute('data-note-id') === el.getAttribute('data-note-id')) === i);
}

function updateNoteNav() {
  const highlights = getOrderedHighlights();
  const total = highlights.length;
  const prevBtn = document.getElementById('btn-note-prev');
  const nextBtn = document.getElementById('btn-note-next');
  const label = document.getElementById('note-nav-label');

  if (total === 0) {
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    label.textContent = '';
    currentNoteIndex = -1;
    return;
  }

  // Clamp index
  if (currentNoteIndex >= total) currentNoteIndex = total - 1;

  if (currentNoteIndex < 0) {
    // Not navigated yet — enable both if there are notes
    prevBtn.disabled = false;
    nextBtn.disabled = false;
    label.textContent = `${total}`;
  } else {
    prevBtn.disabled = currentNoteIndex <= 0;
    nextBtn.disabled = currentNoteIndex >= total - 1;
    label.textContent = `${currentNoteIndex + 1}/${total}`;
  }
}

function scrollToNote(index) {
  const highlights = getOrderedHighlights();
  if (index < 0 || index >= highlights.length) return;
  currentNoteIndex = index;
  const mark = highlights[index];
  const preview = getMdScrollHost();
  if (!preview) return;
  const markTop = elOffsetTopInScrollHost(mark, preview);
  const markHeight = mark.offsetHeight;
  const previewHeight = preview.clientHeight;
  preview.scrollTo({ top: markTop - (previewHeight / 2) + (markHeight / 2), behavior: 'smooth' });

  // Brief flash effect
  mark.style.outline = '2px solid var(--accent)';
  mark.style.outlineOffset = '1px';
  setTimeout(() => { mark.style.outline = ''; mark.style.outlineOffset = ''; }, 1200);

  updateNoteNav();
}

// Find the nearest note index relative to current scroll position
function findNearestNoteIndex() {
  const highlights = getOrderedHighlights();
  if (highlights.length === 0) return -1;
  const preview = getMdScrollHost();
  if (!preview) return -1;
  const scrollCenter = preview.scrollTop + preview.clientHeight / 2;
  let closest = 0;
  let closestDist = Infinity;
  for (let i = 0; i < highlights.length; i++) {
    const center = elOffsetTopInScrollHost(highlights[i], preview) + highlights[i].offsetHeight / 2;
    const dist = Math.abs(center - scrollCenter);
    if (dist < closestDist) { closestDist = dist; closest = i; }
  }
  return closest;
}

document.getElementById('btn-note-prev').addEventListener('click', () => {
  const highlights = getOrderedHighlights();
  if (highlights.length === 0) return;
  if (currentNoteIndex < 0) currentNoteIndex = findNearestNoteIndex();
  // Find the previous note that is above the current scroll center
  const preview = getMdScrollHost();
  if (!preview) return;
  const scrollCenter = preview.scrollTop + preview.clientHeight / 2;
  let target = currentNoteIndex - 1;
  // If current note is below center, the "prev" should go to the nearest one above
  if (currentNoteIndex >= 0 && currentNoteIndex < highlights.length) {
    const curTop = elOffsetTopInScrollHost(highlights[currentNoteIndex], preview) + highlights[currentNoteIndex].offsetHeight / 2;
    if (Math.abs(curTop - scrollCenter) > 10) {
      // Not centered on current note — find nearest above scroll center
      target = -1;
      for (let i = highlights.length - 1; i >= 0; i--) {
        const c = elOffsetTopInScrollHost(highlights[i], preview) + highlights[i].offsetHeight / 2;
        if (c < scrollCenter - 10) {
          target = i; break;
        }
      }
    }
  }
  if (target < 0) return;
  scrollToNote(target);
});

document.getElementById('btn-note-next').addEventListener('click', () => {
  const highlights = getOrderedHighlights();
  if (highlights.length === 0) return;
  if (currentNoteIndex < 0) currentNoteIndex = findNearestNoteIndex();
  const preview = getMdScrollHost();
  if (!preview) return;
  const scrollCenter = preview.scrollTop + preview.clientHeight / 2;
  let target = currentNoteIndex + 1;
  // If current note is above center, the "next" should go to the nearest one below
  if (currentNoteIndex >= 0 && currentNoteIndex < highlights.length) {
    const curTop = elOffsetTopInScrollHost(highlights[currentNoteIndex], preview) + highlights[currentNoteIndex].offsetHeight / 2;
    if (Math.abs(curTop - scrollCenter) > 10) {
      target = highlights.length;
      for (let i = 0; i < highlights.length; i++) {
        const c = elOffsetTopInScrollHost(highlights[i], preview) + highlights[i].offsetHeight / 2;
        if (c > scrollCenter + 10) {
          target = i; break;
        }
      }
    }
  }
  if (target >= highlights.length) return;
  scrollToNote(target);
});

// Keyboard: Left/Right arrow keys trigger note navigation
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;

  // Arrow keys — note navigation
  if (e.key === 'ArrowLeft') {
    document.getElementById('btn-note-prev').click();
  } else if (e.key === 'ArrowRight') {
    document.getElementById('btn-note-next').click();
  }
});

// ============================================================
// Auto-load from server on page load
// ============================================================
function __trioAutoload() {
  loadRootFromServer().then(async () => {
    // Restore folder expand/collapse state if returning from Edit.html
    const savedFolderState = sessionStorage.getItem('trio-folder-state');
    if (savedFolderState) {
      sessionStorage.removeItem('trio-folder-state');
      try {
        restoreExpandedFolders(JSON.parse(savedFolderState));
      } catch {}
    }

    // Auto-open file if returning from Edit.html
    const returnFile = sessionStorage.getItem('trio-return-file');
    if (returnFile) {
      sessionStorage.removeItem('trio-return-file');
      const parts = returnFile.split('/');
      const entry = fileTree ? findEntryByPath(fileTree.children, parts) : null;
      if (entry) selectFile(entry, returnFile);
    }
  }).catch((e) => {
    console.error(e);
    if (typeof showToast === 'function') showToast(`Failed to load folder: ${e.message || e}`);
  });
}

// Module may load after DOMContentLoaded has already fired (dynamic <script>
// injection in index.html does this). Run immediately if the DOM is ready;
// otherwise wait for the event.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', __trioAutoload);
} else {
  __trioAutoload();
}


window.addEventListener('beforeunload', (e) => {
  if (jsonDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
