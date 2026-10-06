import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {
  return (
    <s-page heading="Coleman Classifieds">
      <s-section heading="No listings yet">
        <s-paragraph>
          Listings appear here once sellers have been invited. Start by checking
          the fees and time limits.
        </s-paragraph>
        <s-button href="/app/settings">Open settings</s-button>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
