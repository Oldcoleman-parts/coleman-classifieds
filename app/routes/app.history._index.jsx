import { useRef, useState } from "react";
import { Form, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { loadHistoryScreen } from "@/modules/console/index.js";
import { historyLabel } from "@/modules/console/client.js";

// The History screen (F05-T3): the audit log, filtered, a page at a time, and the CSV of
// exactly what the filters match. Read-only: no edit or delete controls.
export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const params = new URL(request.url).searchParams;
  const get = (name) => params.get(name) ?? undefined;

  return loadHistoryScreen({
    listingId: get("listingId"),
    period: get("period"),
    from: get("from"),
    to: get("to"),
    action: get("action"),
    actor: get("actor"),
    staffEmail: get("staffEmail"),
    after: get("after"),
    before: get("before"),
  });
};

const ACTOR_LABELS = {
  STAFF: "Staff",
  SELLER: "Seller",
  BUYER: "Buyer",
  SYSTEM: "System",
};

const PERIOD_LABELS = {
  7: "Last 7 days",
  30: "Last 30 days",
  90: "Last 90 days",
  365: "Last 12 months",
};

/** The same filters with a page cursor: `{ after }` (older) or `{ before }` (newer). */
const pageHref = (values, cursor) => {
  const query = new URLSearchParams(
    Object.entries({ ...values, ...cursor }).filter(([, value]) => value),
  );
  return `/app/history?${query}`;
};

/** The filters in use, as short chips above the list. */
function appliedChips(values, range) {
  const chips = [];
  if (values.period === "all") chips.push("All dates");
  else if (values.period) chips.push(PERIOD_LABELS[values.period]);
  else if (range) chips.push(`${range.from} to ${range.to}`);
  if (values.listingId) chips.push(`Listing ${values.listingId}`);
  if (values.action) chips.push(historyLabel(values.action));
  if (values.staffEmail) chips.push(`Staff · ${values.staffEmail}`);
  else if (values.actor) chips.push(ACTOR_LABELS[values.actor]);
  return chips;
}

export default function History() {
  const {
    values,
    range,
    fieldErrors,
    rows,
    exportValues,
    nextCursor,
    prevCursor,
    actions,
    actors,
    periods,
    maxDays,
  } = useLoaderData();
  const shopify = useAppBridge();
  const exportForm = useRef(null);
  const [busy, setBusy] = useState(false);
  const invalid = Object.keys(fieldErrors).length > 0;
  const [open, setOpen] = useState(invalid);
  const chips = appliedChips(values, range);

  // The CSV comes from an authenticated POST, then is handed to the browser as a file.
  const download = async () => {
    setBusy(true);
    try {
      const response = await fetch("/app/history/export-csv", {
        method: "POST",
        body: new FormData(exportForm.current),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        shopify.toast.show(result.message ?? "The export failed", {
          isError: true,
        });
        return;
      }
      const name = /filename="([^"]+)"/.exec(
        response.headers.get("Content-Disposition") ?? "",
      );
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = name ? name[1] : "history.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      shopify.toast.show("The export failed", { isError: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <s-page heading="History" inlineSize="large">
      <s-button
        slot="primary-action"
        icon="export"
        disabled={busy || invalid}
        onClick={download}
      >
        Export CSV
      </s-button>
      <form ref={exportForm} onSubmit={(event) => event.preventDefault()}>
        {Object.entries(exportValues).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      </form>

      <s-section padding="none">
        <s-box padding="base" borderWidth="none none base none">
          <s-stack gap="base">
            <s-stack
              direction="inline"
              gap="small"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-button
                  icon="filter"
                  variant={open ? "primary" : "secondary"}
                  onClick={() => setOpen(!open)}
                >
                  Filters
                </s-button>
                {chips.map((chip) => (
                  <s-chip key={chip}>{chip}</s-chip>
                ))}
              </s-stack>
              {chips.length > 0 && <s-link href="/app/history">Reset</s-link>}
            </s-stack>

            {open && (
              <Form method="get">
                <s-stack gap="base">
                  <s-grid
                    gridTemplateColumns="repeat(auto-fill, minmax(200px, 1fr))"
                    gap="base"
                  >
                    <s-select
                      label="Period"
                      name="period"
                      value={values.period || "custom"}
                      error={fieldErrors.period}
                    >
                      <s-option value="custom">Custom dates</s-option>
                      <s-option value="all">
                        All dates (with a listing id)
                      </s-option>
                      {periods.map((period) => (
                        <s-option key={period} value={period}>
                          {PERIOD_LABELS[period]}
                        </s-option>
                      ))}
                    </s-select>
                    <s-date-field
                      label="From"
                      name="from"
                      defaultValue={values.from}
                      error={fieldErrors.from}
                    />
                    <s-date-field
                      label="To"
                      name="to"
                      defaultValue={values.to}
                      error={fieldErrors.to}
                      details={`Custom dates: at most ${maxDays} days.`}
                    />
                    <s-select
                      label="Action"
                      name="action"
                      value={values.action || "any"}
                      error={fieldErrors.action}
                    >
                      <s-option value="any">Any action</s-option>
                      {actions.map((action) => (
                        <s-option key={action} value={action}>
                          {historyLabel(action)}
                        </s-option>
                      ))}
                    </s-select>
                    <s-select
                      label="Done by"
                      name="actor"
                      value={values.actor || "any"}
                      error={fieldErrors.actor}
                    >
                      <s-option value="any">Anyone</s-option>
                      {actors.map((actor) => (
                        <s-option key={actor} value={actor}>
                          {ACTOR_LABELS[actor]}
                        </s-option>
                      ))}
                    </s-select>
                    <s-email-field
                      label="Staff email"
                      name="staffEmail"
                      defaultValue={values.staffEmail}
                      error={fieldErrors.staffEmail}
                    />
                    <s-text-field
                      label="Listing id"
                      name="listingId"
                      defaultValue={values.listingId}
                      error={fieldErrors.listingId}
                      details='With Period "All dates": the full history of this listing.'
                    />
                  </s-grid>
                  <s-stack direction="inline" gap="small">
                    <s-button type="submit" variant="primary">
                      Apply
                    </s-button>
                    <s-button onClick={() => setOpen(false)}>Close</s-button>
                  </s-stack>
                </s-stack>
              </Form>
            )}
          </s-stack>
        </s-box>

        {invalid ? (
          <s-box padding="base">
            <s-banner tone="critical" heading="Check the filters">
              Fix the highlighted filters to see the history.
            </s-banner>
          </s-box>
        ) : rows.length === 0 ? (
          <s-box padding="large-200">
            <s-stack gap="small-200" alignItems="center">
              <s-heading>No history found</s-heading>
              <s-text color="subdued">
                Try a longer period or fewer filters.
              </s-text>
            </s-stack>
          </s-box>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="kicker">When</s-table-header>
              <s-table-header listSlot="primary">What happened</s-table-header>
              <s-table-header listSlot="secondary">Listing</s-table-header>
              <s-table-header listSlot="inline">Done by</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((row) => (
                <s-table-row key={row.id}>
                  <s-table-cell>
                    <s-stack gap="small-500">
                      <s-text>{row.dateLabel}</s-text>
                      <s-text color="subdued">{row.timeLabel}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="small-500">
                      <s-text type="strong">{historyLabel(row.action)}</s-text>
                      {row.summary && (
                        <s-text color="subdued">{row.summary}</s-text>
                      )}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {row.listingId ? (
                      <s-link href={`/app/listings/${row.listingId}`}>
                        {row.listingTitle}
                      </s-link>
                    ) : (
                      <s-text color="subdued">—</s-text>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack gap="small-500">
                      <s-badge tone={row.actor === "STAFF" ? "info" : "auto"}>
                        {ACTOR_LABELS[row.actor]}
                      </s-badge>
                      {row.staffEmail && (
                        <s-text color="subdued">{row.staffEmail}</s-text>
                      )}
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}

        {(prevCursor || nextCursor) && (
          <s-box padding="base" borderWidth="base none none none">
            <s-stack
              direction="inline"
              gap="small"
              alignItems="center"
              justifyContent="center"
            >
              <s-button
                icon="chevron-left"
                accessibilityLabel="Previous page"
                disabled={!prevCursor}
                href={
                  prevCursor
                    ? pageHref(values, { before: prevCursor })
                    : undefined
                }
              />
              <s-button
                icon="chevron-right"
                accessibilityLabel="Next page"
                disabled={!nextCursor}
                href={
                  nextCursor
                    ? pageHref(values, { after: nextCursor })
                    : undefined
                }
              />
            </s-stack>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
