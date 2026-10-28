import { isQueueUnavailableError } from '@cio/jobs';

import { AppError, ErrorCodes } from '@api/utils/errors';

/** A Redis outage on the enqueue path is a retryable 503 "queue unavailable"; anything else stays a 500. */
export function enqueueFailureToAppError(error: unknown, fallbackMessage: string): AppError {
  if (isQueueUnavailableError(error)) {
    return new AppError('Job queue unavailable', ErrorCodes.QUEUE_UNAVAILABLE, 503);
  }

  return new AppError(error instanceof Error ? error : fallbackMessage, ErrorCodes.INTERNAL_ERROR, 500);
}
