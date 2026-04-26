// ============================================================
// marked.js — lightweight Markdown → HTML renderer
// ============================================================
import { marked } from './lib/marked.js';
import { readFile, writeFile } from './fs.js';

marked.setOptions({ gfm: true, breaks: false });

// ============================================================
// Theme — sync with index.html
// ============================================================
const THEME_KEY = 'trio-theme';
const FONT_KEY = 'trio-font-size';

function getTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}
applyTheme(getTheme());

const fontSize = localStorage.getItem(FONT_KEY) || '16';
document.documentElement.style.setProperty('--font-size', fontSize + 'px');

// ============================================================
// Toast
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

// ============================================================
// DOM refs
// ============================================================
const sourceEditor = document.getElementById('source-editor');
const previewBody = document.getElementById('preview-body');

// ============================================================
// Preview rendering with debounce
// ============================================================
let debounceTimer = null;

function renderPreview() {
  previewBody.innerHTML = marked.parse(sourceEditor.value);
}

function schedulePreview() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(renderPreview, 300);
}

sourceEditor.addEventListener('input', schedulePreview);

// ============================================================
// Main — init editor
// ============================================================
const filePath = sessionStorage.getItem('trio-edit-file');
let originalMarkdown = '';
let currentMtime = null;

if (!filePath) {
  document.getElementById('file-name').textContent = 'No file specified';
  document.getElementById('editor-container').innerHTML =
    '<div class="loading">No file to edit. <a href="index.html">Go back</a></div>';
} else {
  initEditor(filePath);
}

async function initEditor(filePath) {
  const fileName = filePath.split('/').pop();
  document.getElementById('file-name').textContent = fileName;

  try {
    const { text, mtime } = await readFile(filePath);
    currentMtime = mtime;
    originalMarkdown = text;

    sourceEditor.value = originalMarkdown;
    renderPreview();

  } catch (err) {
    document.getElementById('editor-container').innerHTML =
      `<div class="loading">Error: ${err.message} <br><a href="index.html">Go back</a></div>`;
  }
}

// ============================================================
// Editor helpers
// ============================================================
function isEditorDirty() {
  return sourceEditor.value !== originalMarkdown;
}

function goBack() {
  const fp = sessionStorage.getItem('trio-edit-file');
  if (fp) sessionStorage.setItem('trio-return-file', fp);
  sessionStorage.removeItem('trio-edit-file');
  window.location.href = 'index.html';
}

// ============================================================
// Save
// ============================================================
async function saveFile() {
  const text = sourceEditor.value;
  try {
    const result = await writeFile(filePath, text, currentMtime);
    currentMtime = result.mtime;
    originalMarkdown = text;
    showToast('Saved');
    setTimeout(goBack, 300);
  } catch (e) {
    if (e.status === 409) {
      const overwrite = confirm('File changed on disk since you opened it. Overwrite?');
      if (overwrite) {
        const result = await writeFile(filePath, text, null);
        currentMtime = result.mtime;
        originalMarkdown = text;
        showToast('Saved (overwrote disk changes)');
        setTimeout(goBack, 300);
      } else {
        const { text: fresh, mtime } = await readFile(filePath);
        currentMtime = mtime;
        sourceEditor.value = fresh;
        originalMarkdown = fresh;
        showToast('Reloaded from disk');
        renderPreview();
      }
    } else {
      showToast(`Save failed: ${e.message || e}`);
    }
  }
}

// ============================================================
// Cancel
// ============================================================
function cancelEdit() {
  if (isEditorDirty()) {
    const action = prompt('You have unsaved changes.\nType "save" to save, "discard" to discard, or press Cancel to continue editing.');
    if (action === null) return;
    const trimmed = action.trim().toLowerCase();
    if (trimmed === 'save') { saveFile(); return; }
    if (trimmed !== 'discard') return;
  }
  goBack();
}

document.getElementById('btn-save').addEventListener('click', saveFile);
document.getElementById('btn-cancel').addEventListener('click', cancelEdit);

// ============================================================
// Toolbar — Markdown syntax insertion
// ============================================================
function wrapSelection(before, after) {
  const start = sourceEditor.selectionStart;
  const end = sourceEditor.selectionEnd;
  const text = sourceEditor.value;
  const selected = text.slice(start, end);
  const replacement = before + (selected || 'text') + (after || '');
  sourceEditor.value = text.slice(0, start) + replacement + text.slice(end);
  // Select the inner text for easy replacement
  const innerStart = start + before.length;
  const innerEnd = innerStart + (selected || 'text').length;
  sourceEditor.setSelectionRange(innerStart, innerEnd);
  sourceEditor.focus();
  schedulePreview();
}

function insertAtLineStart(prefix) {
  const start = sourceEditor.selectionStart;
  const text = sourceEditor.value;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  sourceEditor.value = text.slice(0, lineStart) + prefix + text.slice(lineStart);
  sourceEditor.setSelectionRange(lineStart + prefix.length, lineStart + prefix.length);
  sourceEditor.focus();
  schedulePreview();
}

function insertBlock(block) {
  const start = sourceEditor.selectionStart;
  const text = sourceEditor.value;
  const needsNewline = start > 0 && text[start - 1] !== '\n' ? '\n' : '';
  sourceEditor.value = text.slice(0, start) + needsNewline + block + text.slice(start);
  const cursor = start + needsNewline.length + block.length;
  sourceEditor.setSelectionRange(cursor, cursor);
  sourceEditor.focus();
  schedulePreview();
}

const toolbarActions = {
  toggleStrong:        () => wrapSelection('**', '**'),
  toggleEmphasis:      () => wrapSelection('*', '*'),
  toggleStrikethrough: () => wrapSelection('~~', '~~'),
  toggleInlineCode:    () => wrapSelection('`', '`'),
  heading1:            () => insertAtLineStart('# '),
  heading2:            () => insertAtLineStart('## '),
  heading3:            () => insertAtLineStart('### '),
  bulletList:          () => insertAtLineStart('- '),
  orderedList:         () => insertAtLineStart('1. '),
  blockquote:          () => insertAtLineStart('> '),
  codeBlock:           () => insertBlock('```\ncode\n```\n'),
  hr:                  () => insertBlock('---\n'),
  link: () => {
    const url = prompt('Enter URL:');
    if (url) wrapSelection('[', `](${url})`);
  },
  image: () => {
    const url = prompt('Enter image URL:');
    if (url) insertBlock(`![alt](${url})\n`);
  },
  table: () => insertBlock('| Header | Header |\n| ------ | ------ |\n| Cell   | Cell   |\n'),
};

document.getElementById('editor-toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cmd]');
  if (!btn) return;
  const cmd = btn.getAttribute('data-cmd');
  const action = toolbarActions[cmd];
  if (action) action();
});

// ============================================================
// Keyboard shortcuts
// ============================================================
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveFile();
    return;
  }
  if (e.key === 'Escape') {
    cancelEdit();
  }
});

// Tab key inserts tab in textarea
sourceEditor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = sourceEditor.selectionStart;
    const end = sourceEditor.selectionEnd;
    sourceEditor.value = sourceEditor.value.slice(0, start) + '\t' + sourceEditor.value.slice(end);
    sourceEditor.selectionStart = sourceEditor.selectionEnd = start + 1;
    schedulePreview();
  }
});

// ============================================================
// Scroll sync — percentage-based
// ============================================================
let syncingScroll = false;

function syncScroll(source, target) {
  if (syncingScroll) return;
  syncingScroll = true;
  const maxScroll = source.scrollHeight - source.clientHeight;
  const ratio = maxScroll > 0 ? source.scrollTop / maxScroll : 0;
  target.scrollTop = ratio * (target.scrollHeight - target.clientHeight);
  requestAnimationFrame(() => { syncingScroll = false; });
}

sourceEditor.addEventListener('scroll', () => syncScroll(sourceEditor, previewBody));
previewBody.addEventListener('scroll', () => syncScroll(previewBody, sourceEditor));

// ============================================================
// Prevent accidental data loss
// ============================================================
window.addEventListener('beforeunload', (e) => {
  if (isEditorDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});
