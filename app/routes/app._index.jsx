import { Form, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadListingList } from "@/modules/console/index.js";
import { statusBadge } from "@/modules/console/client.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);

  return loadListingList({
    tab: url.searchParams.get("tab"),
    q: url.searchParams.get("q"),
    cursor: url.searchParams.get("cursor"),
  });
};

function badge(status) {
  const [label, tone] = statusBadge(status);
  return <s-badge tone={tone}>{label}</s-badge>;
}

const tabHref = (key, q) =>
  `/app?${new URLSearchParams({ tab: key, ...(q ? { q } : {}) })}`;

export default function Index() {
  const { tab, q, tabs, rows, nextCursor } = useLoaderData();

  return (
    <s-page heading="Listings">
      <s-button slot="primary-action" href="/app/invitations/new">
        New invitation
      </s-button>
      <s-section>
        <s-stack gap="base">
          <s-stack direction="inline" gap="small">
            {tabs.map((each) => (
              <s-button
                key={each.key}
                href={tabHref(each.key, q)}
                variant={each.key === tab ? "primary" : "secondary"}
              >
                {each.label} ({each.count})
              </s-button>
            ))}
          </s-stack>
          <Form method="get">
            <input type="hidden" name="tab" value={tab} />
            <s-stack direction="inline" gap="small">
              <s-search-field
                label="Search"
                labelAccessibilityVisibility="exclusive"
                name="q"
                placeholder="Title, seller name or email"
                defaultValue={q}
              />
              <s-button type="submit">Search</s-button>
            </s-stack>
          </Form>
          {rows.length === 0 ? (
            <s-paragraph>No listings here.</s-paragraph>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">Listing</s-table-header>
                <s-table-header>Seller</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Fee</s-table-header>
                <s-table-header>Ends</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {rows.map((row) => (
                  <s-table-row key={row.id}>
                    <s-table-cell>
                      <s-link href={`/app/listings/${row.id}`}>
                        {row.title}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>{row.sellerName}</s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        {badge(row.status)}
                        {row.changePending && (
                          <s-badge tone="warning">Change to review</s-badge>
                        )}
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>{row.feeState}</s-table-cell>
                    <s-table-cell>
                      {row.expiresAt
                        ? new Date(row.expiresAt).toLocaleDateString()
                        : "—"}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          )}
          {nextCursor && (
            <s-button
              href={`/app?${new URLSearchParams({ tab, ...(q ? { q } : {}), cursor: nextCursor })}`}
            >
              Next page
            </s-button>
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
