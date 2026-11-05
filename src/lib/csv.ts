/**
 * CSV export compatible with Excel: UTF-8 with BOM (so Arabic text opens
 * correctly), CRLF line endings and RFC 4180 quoting.
 */
export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const escape = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? '' : String(value);
    // Neutralise spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d[\d,.]*$/.test(text) ? `'${text}` : text;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
}

export function downloadCsv(fileName: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const blob = new Blob(['﻿', toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, fileName.endsWith('.csv') ? fileName : `${fileName}.csv`);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
