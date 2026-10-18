// Minimal RFC 4180 CSV (SPEC §2.3: CSV instead of Excel). Shared so the web can preview imports too.

/** Parses CSV text into rows of cells. Handles quotes, escaped quotes, CRLF and a leading BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // Drop fully empty lines (common at end of files).
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Parses CSV with a header row into objects keyed by lower-cased, trimmed header names. */
export function parseCsvRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const [header, ...body] = parseCsv(text);
  const headers = (header ?? []).map((h) => h.trim().toLowerCase());
  const records = body.map((cells) => Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()])));
  return { headers, records };
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds CSV with a UTF-8 BOM so Excel detects the encoding. */
export function toCsv(headers: string[], rows: unknown[][]): string {
  return '﻿' + [headers, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n';
}
