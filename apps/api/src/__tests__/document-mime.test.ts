import { describe, expect, it } from 'vitest';
import { ZFeedbackPresign } from '@cio/utils/validation/coursework';
import {
  ALLOWED_DOCUMENT_TYPES,
  DOCUMENT_EXTENSION_MIME,
  MAX_PRESIGN_FILES,
  isAllowedDocumentFile,
  resolveDocumentMimeType
} from '@cio/utils/validation/constants';

describe('resolveDocumentMimeType', () => {
  it('keeps a browser-reported type', () => {
    expect(resolveDocumentMimeType('a.pdf', 'application/pdf')).toBe('application/pdf');
  });
  it('derives from the extension when the browser reports nothing (case-insensitive)', () => {
    expect(resolveDocumentMimeType('Marked Up.DOCX', '')).toBe(DOCUMENT_EXTENSION_MIME.docx);
    expect(resolveDocumentMimeType('a.b.pdf')).toBe('application/pdf');
  });
  it('prefers the extension when the browser reports a generic/non-allowed type', () => {
    expect(resolveDocumentMimeType('work.docx', 'application/octet-stream')).toBe(DOCUMENT_EXTENSION_MIME.docx);
    expect(isAllowedDocumentFile('work.pdf', 'application/x-unknown')).toBe(true);
    expect(isAllowedDocumentFile('pic.png', 'application/octet-stream')).toBe(false);
  });
  it('returns empty for unknown extensions', () => {
    expect(resolveDocumentMimeType('a.exe', '')).toBe('');
    expect(resolveDocumentMimeType('noext', '')).toBe('');
  });
  it('the ext map covers exactly the server allow-list', () => {
    expect(new Set(Object.values(DOCUMENT_EXTENSION_MIME))).toEqual(new Set(ALLOWED_DOCUMENT_TYPES));
  });
  it('isAllowedDocumentFile', () => {
    expect(isAllowedDocumentFile('a.docx', '')).toBe(true);
    expect(isAllowedDocumentFile('a.png', 'image/png')).toBe(false);
  });
  it('feedback presign caps the file count at MAX_PRESIGN_FILES', () => {
    const file = { fileName: 'a.pdf', fileType: 'application/pdf' };
    expect(ZFeedbackPresign.safeParse({ files: Array(MAX_PRESIGN_FILES).fill(file) }).success).toBe(true);
    expect(ZFeedbackPresign.safeParse({ files: Array(MAX_PRESIGN_FILES + 1).fill(file) }).success).toBe(false);
  });
});
