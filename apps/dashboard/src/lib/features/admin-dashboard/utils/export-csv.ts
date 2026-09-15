// Small client-only CSV export helper for the admin dashboard tables. Builds a CSV string, wraps it in a
// Blob, and triggers a download via a temporary anchor. Fields containing commas, quotes or newlines are
// quoted (and inner quotes doubled) per RFC 4180.

function escapeField(value: string | number): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  if (typeof document === 'undefined') return;

  const lines = [headers, ...rows].map((row) => row.map(escapeField).join(','));
  const csv = lines.join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
