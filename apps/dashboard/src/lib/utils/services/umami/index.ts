// Umami analytics removed for privacy (PearlLMS fork). The vendor build injected a
// script from umami.hz.oncws.com on every page. This is now an inert no-op so
// callers keep compiling but no analytics script is ever loaded. Do not
// reintroduce the remote script.

export const initUmami = (): void => {};
