import { toast } from '../core/errorHandler.js';

/**
 * Handles specialized keyboard interactions for the markdown text editor
 * (auto-pairing, list continuation, indentation, etc.)
 */
export function handleEditorKeydown(e, editor) {
    if (e._brocoProcessed) return;

    try {
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const value = editor.value;

        const pairs = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '*': '*', '_': '_', '`': '`' };
        const selection = value.substring(start, end);

        // Auto-pairing
        if (pairs[e.key]) {
            e.preventDefault();
            e._brocoProcessed = true;
            if (e.key === '[' && value[start - 1] === '[') {
                editor.value = value.substring(0, start) + '[' + selection + ']]' + value.substring(end);
                editor.selectionStart = start + 1;
                editor.selectionEnd = start + 1 + selection.length;
            } else {
                editor.value = value.substring(0, start) + e.key + selection + pairs[e.key] + value.substring(end);
                editor.selectionStart = start + 1;
                editor.selectionEnd = start + 1 + selection.length;
            }
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }

        // Tab / Indentation
        if (e.key === 'Tab') {
            e.preventDefault();
            e._brocoProcessed = true;
            const lineStart = value.lastIndexOf('\n', start - 1) + 1;
            const lineEnd = value.indexOf('\n', start);
            const line = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);
            const listMatch = line.match(/^(\s*)([-*+]|\d+\.)(\s+.*)?$/);

            if (listMatch) {
                if (!e.shiftKey) {
                    // Indent
                    const newLine = listMatch[1] + '  ' + listMatch[2] + (listMatch[3] || '');
                    editor.value = value.substring(0, lineStart) + newLine + value.substring(lineEnd === -1 ? value.length : lineEnd);
                    editor.selectionStart = editor.selectionEnd = start + 2;
                } else if (listMatch[1].length >= 2) {
                    // Outdent
                    const newLine = listMatch[1].substring(2) + listMatch[2] + (listMatch[3] || '');
                    editor.value = value.substring(0, lineStart) + newLine + value.substring(lineEnd === -1 ? value.length : lineEnd);
                    editor.selectionStart = editor.selectionEnd = Math.max(lineStart, start - 2);
                }
            } else {
                // General tab
                const before = value.substring(0, start);
                const after = value.substring(end);
                editor.value = before + '  ' + after;
                editor.selectionStart = editor.selectionEnd = start + 2;
            }
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            return;
        }

        // Auto-list on Enter
        if (e.key === 'Enter') {
            const lineStart = value.lastIndexOf('\n', start - 1) + 1;
            const lineEnd = value.indexOf('\n', start);
            const line = value.substring(lineStart, start);
            const listMatch = line.match(/^(\s*)([-*+]|(\d+)\.)(\s+)/);

            if (listMatch) {
                e.preventDefault();
                e._brocoProcessed = true;
                const indent = listMatch[1];
                const marker = listMatch[2];
                const number = listMatch[3];
                const space = listMatch[4];

                if (line.trim() === marker.trim()) {
                    // Empty list item: Move up the hierarchy
                    if (indent.length >= 2) {
                        // Outdent on SAME line (no gap)
                        const newIndent = indent.substring(2);
                        const before = value.substring(0, lineStart);
                        const after = value.substring(start);
                        editor.value = before + newIndent + marker + space + after;
                        const newPos = lineStart + newIndent.length + marker.length + space.length;
                        editor.setSelectionRange(newPos, newPos);
                    } else {
                        // At root: End list
                        const before = value.substring(0, lineStart);
                        const after = value.substring(start);
                        editor.value = before + '\n' + after;
                        editor.setSelectionRange(lineStart + 1, lineStart + 1);
                    }
                } else {
                    // Content item: Continue list
                    let nextMarker = marker;
                    if (number) nextMarker = (parseInt(number, 10) + 1) + '.';
                    const prefix = '\n' + indent + nextMarker + space;
                    editor.setRangeText(prefix, start, start, 'end');
                }
                editor.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            } else {
                // Preserve indentation for non-list lines
                const contentIndentMatch = line.match(/^(\s+)/);
                if (contentIndentMatch && contentIndentMatch[1].length > 0) {
                    e.preventDefault();
                    e._brocoProcessed = true;
                    const indent = contentIndentMatch[1];
                    const prefix = '\n' + indent;
                    editor.setRangeText(prefix, start, start, 'end');
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                    return;
                }
            }
        }

        // Escape or Ctrl+K
        if (e.key === 'Escape') {
            e.preventDefault();
            e._brocoProcessed = true;
            editor.blur();
            return;
        }

        if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e._brocoProcessed = true;
            const selected = value.substring(start, end);
            const link = selected ? `[${selected}](url)` : `[link text](url)`;
            editor.setRangeText(link, start, end, 'select');
            if (selected) {
                editor.selectionStart = start + selected.length + 3;
                editor.selectionEnd = editor.selectionStart + 3;
            }
            editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
    } catch (error) {
        console.error('Editor Error:', error);
        toast.error('Editor action failed. Click to debug.');
    }
}
