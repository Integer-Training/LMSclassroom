import { QUESTION_TYPE_IDS } from '@cio/question-types';

/**
 * Validation Constants
 *
 * Shared constants used across validation schemas.
 * These should match the constants in the API.
 */

export const ALLOWED_CONTENT_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'] as const;

export const ALLOWED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // .doc
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint' // .ppt
] as const;

/**
 * Extension -> MIME map for the ALLOWED_DOCUMENT_TYPES above (keep the two in step). Browsers report an EMPTY
 * File.type for some files (e.g. .docx on a machine with no Office file association), which the presign validators
 * reject; clients derive the type from the extension via resolveDocumentMimeType() instead.
 */
export const DOCUMENT_EXTENSION_MIME: Record<string, (typeof ALLOWED_DOCUMENT_TYPES)[number]> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint'
};

/** Value for an <input type="file" accept> that matches ALLOWED_DOCUMENT_TYPES exactly (extensions + MIME types). */
export const ALLOWED_DOCUMENT_ACCEPT = [
  ...Object.keys(DOCUMENT_EXTENSION_MIME).map((ext) => `.${ext}`),
  ...ALLOWED_DOCUMENT_TYPES
].join(',');

/** Human label for the document allow-list, used in user-facing messages. */
export const ALLOWED_DOCUMENT_TYPES_LABEL = 'PDF, Word (.doc, .docx) or PowerPoint (.ppt, .pptx)';

/** Max files in one presign request (coursework upload + tutor feedback upload). Enforced by the Zod validators. */
export const MAX_PRESIGN_FILES = 10;

/**
 * The MIME type to send for a document upload: the browser-reported type when it is on the allow-list, otherwise the
 * type derived from the file extension (browsers report '' or a generic type such as application/octet-stream for
 * some .docx/.pdf files). Falls back to the reported type, or '' when neither is known (callers then reject the file).
 */
export function resolveDocumentMimeType(fileName: string, reportedType?: string): string {
  const reported = reportedType?.trim() ?? '';
  if (reported && (ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(reported)) return reported;
  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
  return DOCUMENT_EXTENSION_MIME[ext] ?? reported;
}

/** True when the (resolved) MIME type of this file is on the document allow-list. */
export function isAllowedDocumentFile(fileName: string, reportedType?: string): boolean {
  return (ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(resolveDocumentMimeType(fileName, reportedType));
}

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'] as const;

/**
 * Question Type Constants
 * These match canonical question type ids.
 */
export const QUESTION_TYPE = QUESTION_TYPE_IDS;
