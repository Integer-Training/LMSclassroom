// The implementation lives in @cio/core so packages (s3 presign cache, ...) can bound Redis I/O too.
export { TimeoutError, withTimeout } from '@cio/core/utils/with-timeout';
