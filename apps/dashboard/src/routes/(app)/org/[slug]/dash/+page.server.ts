// The admin dashboard (PearlLMS) loads its data client-side from the current org via the typed RPC
// client, so the server load only needs to surface the org id + site name. The old dash.stats /
// login-activity fetches were removed — that data is no longer rendered here.
export const load = async ({ params, parent }) => {
  const { orgId } = await parent();
  const siteName = params.slug;

  return {
    orgId,
    siteName
  };
};
