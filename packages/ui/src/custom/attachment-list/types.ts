export type AttachmentListFile = {
  id: string;
  name: string;
  size?: number;
  /** File extension (e.g. `pdf`, `docx`) or MIME type (e.g. `application/pdf`). Used for icon styling. */
  type?: string;
  /**
   * When explicitly `false`, the download action is hidden (view-only). `undefined`/`true` keep it shown, so
   * other AttachmentList usages that don't set this are unaffected. Course materials set it per-file
   * (admin-controlled download toggle).
   */
  downloadable?: boolean;
};

export type AttachmentListMode = 'view' | 'edit';

export type AttachmentListLabels = {
  title: string;
  fileCount: string;
  view: string;
  download: string;
  delete: string;
  reorder: string;
};
