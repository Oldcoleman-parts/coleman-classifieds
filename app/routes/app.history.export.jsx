import { authenticate } from "../shopify.server";

// The export form became the History screen (F05-T3). Old links (and bookmarks) land
// there with their query, so `listingId` and the embedded-app params are kept.
export const loader = async ({ request }) => {
  const { redirect } = await authenticate.admin(request);
  const { search } = new URL(request.url);

  return redirect(`/app/history${search}`);
};
