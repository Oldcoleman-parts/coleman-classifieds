import { createContext, useContext, useEffect, useRef, useState } from "react";
import { data, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getLinkUrl } from "@/modules/access/index.js";
import {
  handleReviewAction,
  loadReviewScreen,
} from "@/modules/console/index.js";
import { dollars, statusBadge } from "@/modules/console/client.js";
import { staffFromSession } from "@/modules/core/index.js";
import { uploadPhoto } from "@/modules/media/client.js";

export const loader = async ({ request, params }) => {
  await authenticate.admin(request);
  const screen = await loadReviewScreen(params.id);
  if (!screen) throw new Response("Not found", { status: 404 });

  return screen;
};

export const action = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const result = await handleReviewAction(params.id, await request.formData(), {
    actor: staffFromSession(session),
    getLinkUrl: () => getLinkUrl(admin, session.shop),
  });

  return result.ok ? result : data(result, { status: 400 });
};

const DONE = {
  approve: "Listing approved",
  "request-changes": "Changes requested",
  reject: "Listing declined",
  "approve-revision": "Change approved",
  "reject-revision": "Change declined",
  pause: "Listing paused",
  resume: "Listing resumed",
  extend: "Listing extended",
  "edit-wording": "Wording saved",
  "delete-photo": "Photo deleted",
  "order-photos": "Photo order saved",
  "set-main": "Main photo set",
};

const day = (iso) => (iso ? new Date(iso).toLocaleDateString() : "—");
const when = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

// One fetcher shared by every section of the screen.
const Actions = createContext(null);

/** One fetcher for every action; `run(intent, fields)` posts, `runForm(ref)` posts a form. */
function useActions() {
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  useEffect(() => {
    if (fetcher.data?.ok && DONE[fetcher.data.intent])
      shopify.toast.show(DONE[fetcher.data.intent]);
  }, [fetcher.data, shopify]);
  return {
    fetcher,
    busy: fetcher.state !== "idle",
    errors: fetcher.data?.ok === false ? fetcher.data.fieldErrors : {},
    failed: fetcher.data?.ok === false ? fetcher.data.message : null,
    run: (intent, fields = {}) => {
      const form = new FormData();
      form.append("intent", intent);
      for (const [name, value] of Object.entries(fields))
        for (const each of [value].flat()) form.append(name, each);
      fetcher.submit(form, { method: "post" });
    },
    runForm: (ref) =>
      fetcher.submit(new FormData(ref.current), { method: "post" }),
  };
}

export default function Listing() {
  const listing = useLoaderData();
  const actions = useActions();
  const [label, tone] = statusBadge(listing.status);

  return (
    <Actions.Provider value={actions}>
      <s-page heading={listing.preview.title ?? listing.seller.itemSummary}>
        <s-link slot="breadcrumb-actions" href="/app">
          Listings
        </s-link>
        {actions.failed && (
          <s-banner tone="critical">{actions.failed}</s-banner>
        )}

        <s-section heading="Status">
          <s-stack gap="small">
            <s-stack direction="inline" gap="small">
              <s-badge tone={tone}>{label}</s-badge>
              {listing.pauseReason && (
                <s-badge>
                  {listing.pauseReason === "INVESTIGATION"
                    ? "Investigation"
                    : "Ordinary pause"}
                </s-badge>
              )}
            </s-stack>
            <Dates />
          </s-stack>
        </s-section>

        {listing.revision && <Revision />}
        <Decision />
        <Manage />
        <Preview />
        {listing.actions.editWording && <Wording />}
        <Photos />
        <Seller />
        <Payments />
      </s-page>
    </Actions.Provider>
  );
}

function Dates() {
  const { dates } = useLoaderData();
  const rows = [
    ["Draft due", dates.draftDueBy],
    ["Corrections due", dates.correctionDueBy],
    ["Payment due", dates.paymentDueBy],
    ["Live since", dates.liveAt],
    ["Ends", dates.expiresAt],
    ["Paused since", dates.pausedAt],
    ["Closed", dates.closedAt],
  ].filter(([, value]) => value);
  if (rows.length === 0) return null;
  return (
    <s-text>
      {rows.map(([name, value]) => `${name}: ${when(value)}`).join(" · ")}
    </s-text>
  );
}

/** Approve, request changes or decline a listing under review. */
function Decision() {
  const actions = useContext(Actions);
  const listing = useLoaderData();
  const changesForm = useRef(null);
  const rejectForm = useRef(null);
  const { approve, requestChanges, reject } = listing.actions;
  if (!approve && !requestChanges && !reject) return null;
  const photoIds = (listing.photos ?? []).map((photo) => photo.id);

  return (
    <s-section heading="Review">
      <s-stack gap="base">
        {approve && (
          <s-stack gap="small">
            <s-paragraph>
              Approving publishes nothing yet: the seller is asked to pay, and
              the listing goes live when they do. The{" "}
              {photoIds.length === 1 ? "photo" : `${photoIds.length} photos`}{" "}
              shown below are approved with it.
            </s-paragraph>
            <s-button
              variant="primary"
              disabled={actions.busy}
              onClick={() => actions.run("approve", { photoIds })}
            >
              Approve
            </s-button>
          </s-stack>
        )}
        {requestChanges && (
          <form ref={changesForm} onSubmit={(event) => event.preventDefault()}>
            <input type="hidden" name="intent" value="request-changes" />
            <s-stack gap="small">
              <s-text-area
                label="What should the seller change?"
                name="note"
                rows={3}
                maxLength={2000}
                error={actions.errors.note}
                details={`The seller gets this note by email and has ${listing.correctionWindowDays} days to send the listing back.`}
              />
              <s-button
                disabled={actions.busy}
                onClick={() => actions.runForm(changesForm)}
              >
                Request changes
              </s-button>
            </s-stack>
          </form>
        )}
        {reject && (
          <form ref={rejectForm} onSubmit={(event) => event.preventDefault()}>
            <input type="hidden" name="intent" value="reject" />
            <s-stack gap="small">
              <s-text-area
                label="Reason for declining"
                name="note"
                rows={2}
                maxLength={2000}
                error={actions.errors.note}
                details="Sent to the seller by email."
              />
              <s-button
                tone="critical"
                commandFor="reject-listing"
                command="--show"
              >
                Decline listing
              </s-button>
            </s-stack>
          </form>
        )}
      </s-stack>
      {confirmModal({
        id: "reject-listing",
        heading: "Decline this listing?",
        action: "Decline",
        onConfirm: () => actions.runForm(rejectForm),
        text: "The seller’s link closes and nothing is charged. The reason is emailed to the seller. This can’t be undone.",
      })}
    </s-section>
  );
}

/** A change to a live listing, side by side with what is live now. */
function Revision() {
  const actions = useContext(Actions);
  const listing = useLoaderData();
  const { revision } = listing;
  const rejectForm = useRef(null);
  const [chosen, setChosen] = useState(revision.photoIds);
  const newPhotos = (listing.photos ?? []).filter((photo) =>
    revision.photoIds.includes(photo.id),
  );
  const toggle = (id) =>
    setChosen((now) =>
      now.includes(id) ? now.filter((each) => each !== id) : [...now, id],
    );

  return (
    <s-section heading="Change to review">
      <s-stack gap="base">
        {!listing.actions.decideRevision && (
          <s-banner tone="info">
            Resume the listing before deciding on this change.
          </s-banner>
        )}
        <s-grid gridTemplateColumns="1fr 1fr" gap="base">
          <s-stack gap="small">
            <s-heading>Live now</s-heading>
            <s-text type="strong">{revision.before.title}</s-text>
            <s-paragraph>{revision.before.description}</s-paragraph>
          </s-stack>
          <s-stack gap="small">
            <s-heading>Proposed</s-heading>
            <s-text type="strong">
              {revision.after.title ?? revision.before.title}
            </s-text>
            <s-paragraph>
              {revision.after.description ?? revision.before.description}
            </s-paragraph>
          </s-stack>
        </s-grid>
        {newPhotos.length > 0 && (
          <s-stack direction="inline" gap="base">
            {newPhotos.map((photo) => (
              <s-stack key={photo.id} gap="small">
                <s-thumbnail src={photo.previewUrl} alt="" size="large" />
                <s-checkbox
                  label="Approve photo"
                  {...(chosen.includes(photo.id) ? { checked: "" } : {})}
                  onChange={() => toggle(photo.id)}
                />
              </s-stack>
            ))}
          </s-stack>
        )}
        <s-paragraph>The listing’s end date doesn’t change.</s-paragraph>
        {listing.actions.decideRevision && (
          <form ref={rejectForm} onSubmit={(event) => event.preventDefault()}>
            <input type="hidden" name="intent" value="reject-revision" />
            <input type="hidden" name="revisionId" value={revision.id} />
            <s-stack gap="small">
              <s-text-area
                label="Note to the seller if you decline (optional)"
                name="note"
                rows={2}
                maxLength={2000}
              />
              <s-stack direction="inline" gap="small">
                <s-button
                  variant="primary"
                  disabled={actions.busy}
                  onClick={() =>
                    actions.run("approve-revision", {
                      revisionId: revision.id,
                      photoIds: chosen,
                    })
                  }
                >
                  Approve change
                </s-button>
                <s-button
                  tone="critical"
                  commandFor="reject-revision"
                  command="--show"
                >
                  Decline change
                </s-button>
              </s-stack>
            </s-stack>
          </form>
        )}
      </s-stack>
      {confirmModal({
        id: "reject-revision",
        heading: "Decline this change?",
        action: "Decline change",
        onConfirm: () => actions.runForm(rejectForm),
        text: "The live listing stays as it is and the seller is told by email. New photos sent with the change are deleted.",
      })}
    </s-section>
  );
}

/** Pause, resume and extend a live or paused listing. */
function Manage() {
  const actions = useContext(Actions);
  const listing = useLoaderData();
  const pauseForm = useRef(null);
  const resumeForm = useRef(null);
  const extendForm = useRef(null);
  const { pause, resume, extend } = listing.actions;
  if (!pause && !resume && !extend) return null;
  const investigation = listing.pauseReason === "INVESTIGATION";

  return (
    <s-section heading="Manage">
      <s-stack gap="large">
        {pause && (
          <form ref={pauseForm} onSubmit={(event) => event.preventDefault()}>
            <input type="hidden" name="intent" value="pause" />
            <s-stack gap="small">
              <s-select
                label="Reason"
                name="reason"
                error={actions.errors.reason}
              >
                <s-option value="ORDINARY">
                  Ordinary pause (end date stays the same)
                </s-option>
                <s-option value="INVESTIGATION">
                  Investigation (time is given back if there was no violation)
                </s-option>
              </s-select>
              <s-button commandFor="pause-listing" command="--show">
                Pause listing
              </s-button>
            </s-stack>
          </form>
        )}
        {resume && (
          <form ref={resumeForm} onSubmit={(event) => event.preventDefault()}>
            <input type="hidden" name="intent" value="resume" />
            <s-stack gap="small">
              {investigation && (
                <s-select
                  label="Was a violation found?"
                  name="violation"
                  error={actions.errors.violation}
                >
                  <s-option value="">Choose…</s-option>
                  <s-option value="no">
                    No: give back the time it was paused
                  </s-option>
                  <s-option value="yes">Yes: no time is given back</s-option>
                </s-select>
              )}
              <s-button
                disabled={actions.busy}
                onClick={() => actions.runForm(resumeForm)}
              >
                Resume listing
              </s-button>
            </s-stack>
          </form>
        )}
        {extend && (
          <form ref={extendForm} onSubmit={(event) => event.preventDefault()}>
            <input type="hidden" name="intent" value="extend" />
            <s-stack gap="small">
              <s-number-field
                label="Days to add"
                name="days"
                min={1}
                max={60}
                step={1}
                error={actions.errors.days ?? actions.errors.minutes}
              />
              <s-text-field
                label="Reason"
                name="reason"
                maxLength={500}
                error={actions.errors.reason}
                details="For example, the listing was hidden by a site problem."
              />
              <s-button
                disabled={actions.busy}
                onClick={() => actions.runForm(extendForm)}
              >
                Extend
              </s-button>
            </s-stack>
          </form>
        )}
      </s-stack>
      {confirmModal({
        id: "pause-listing",
        heading: "Pause this listing?",
        action: "Pause",
        onConfirm: () => actions.runForm(pauseForm),
        text: "The listing is hidden from buyers until you resume it.",
      })}
    </s-section>
  );
}

/** What buyers would see. */
function Preview() {
  const { preview } = useLoaderData();
  const rows = [
    ["Price", dollars(preview.askingPriceCents)],
    ["Quantity", preview.quantityAvailable],
    ["Availability", preview.availabilityNote],
    ["Condition", preview.condition],
    ["Known issues", preview.knownIssues],
    ["Included", preview.contents],
    ["Location", [preview.city, preview.state].filter(Boolean).join(", ")],
    [
      "Arrangements",
      [...preview.arrangements, preview.arrangementsNote]
        .filter(Boolean)
        .join(", "),
    ],
    ["Shown as", preview.sellerDisplay],
  ].filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );

  return (
    <s-section heading="Public preview">
      <s-stack gap="small">
        <s-heading>{preview.title ?? "No title yet"}</s-heading>
        <s-paragraph>
          {preview.description ?? "No description yet."}
        </s-paragraph>
        {rows.map(([name, value]) => (
          <s-text key={name}>
            {name}: {value}
          </s-text>
        ))}
      </s-stack>
    </s-section>
  );
}

/** Staff fix the title and description while the listing is under review. */
function Wording() {
  const actions = useContext(Actions);
  const { preview } = useLoaderData();
  const form = useRef(null);
  return (
    <s-section heading="Edit wording">
      <form
        ref={form}
        onSubmit={(event) => event.preventDefault()}
        key={`${preview.title}|${preview.description}`}
      >
        <input type="hidden" name="intent" value="edit-wording" />
        <s-stack gap="small">
          <s-text-field
            label="Title"
            name="title"
            defaultValue={preview.title ?? ""}
            maxLength={120}
            error={actions.errors.title}
          />
          <s-text-area
            label="Description"
            name="description"
            rows={6}
            defaultValue={preview.description ?? ""}
            maxLength={5000}
            error={actions.errors.description}
          />
          <s-button
            disabled={actions.busy}
            onClick={() => actions.runForm(form)}
          >
            Save wording
          </s-button>
        </s-stack>
      </form>
    </s-section>
  );
}

/** Photos: main photo first. Staff change the set only while reviewing. */
function Photos() {
  const actions = useContext(Actions);
  const listing = useLoaderData();
  const shopify = useAppBridge();
  const { revalidate } = useRevalidator();
  const [progress, setProgress] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const { editPhotos, deletePhotos } = listing.actions;

  if (listing.photos === null)
    return (
      <s-section heading="Photos">
        <s-paragraph>
          Photo storage isn’t set up on this environment.
        </s-paragraph>
      </s-section>
    );

  const ids = listing.photos.map((photo) => photo.id);
  const move = (index, by) => {
    const order = [...ids];
    const [moved] = order.splice(index, 1);
    order.splice(index + by, 0, moved);
    actions.run("order-photos", { photoIds: order });
  };

  const call = async (body) => {
    const response = await fetch(`/app/listings/${listing.id}/photos`, {
      method: "POST",
      body: new URLSearchParams(body),
    });
    const result = await response.json();
    if (!result.ok)
      throw new Error(result.message || "The photo couldn’t be saved");
    return result;
  };

  const onFiles = async (event) => {
    for (const file of [...(event.currentTarget.files ?? [])]) {
      try {
        await uploadPhoto(file, {
          getUploadUrl: async (input) =>
            (await call({ intent: "upload-url", ...input })).upload,
          complete: (photoId) => call({ intent: "upload-complete", photoId }),
          onProgress: setProgress,
        });
      } catch (error) {
        shopify.toast.show(error.message, { isError: true });
      }
    }
    setProgress(null);
    revalidate();
  };

  return (
    <s-section heading="Photos">
      <s-stack gap="base">
        {listing.photos.length === 0 && <s-paragraph>No photos.</s-paragraph>}
        <s-stack direction="inline" gap="base">
          {listing.photos.map((photo, index) => (
            <s-stack key={photo.id} gap="small">
              <s-thumbnail src={photo.previewUrl} alt="" size="large" />
              <s-stack direction="inline" gap="small-200">
                {photo.isMain && <s-badge>Main photo</s-badge>}
                {!photo.approved && (
                  <s-badge tone="warning">Not approved</s-badge>
                )}
              </s-stack>
              {editPhotos && (
                <s-stack direction="inline" gap="small-200">
                  {!photo.isMain && (
                    <s-button
                      variant="tertiary"
                      disabled={actions.busy}
                      onClick={() =>
                        actions.run("set-main", { photoId: photo.id })
                      }
                    >
                      Make main
                    </s-button>
                  )}
                  {index > 0 && (
                    <s-button
                      variant="tertiary"
                      accessibilityLabel="Move earlier"
                      disabled={actions.busy}
                      onClick={() => move(index, -1)}
                    >
                      ←
                    </s-button>
                  )}
                  {index < ids.length - 1 && (
                    <s-button
                      variant="tertiary"
                      accessibilityLabel="Move later"
                      disabled={actions.busy}
                      onClick={() => move(index, 1)}
                    >
                      →
                    </s-button>
                  )}
                </s-stack>
              )}
              {deletePhotos && (
                <s-button
                  tone="critical"
                  variant="tertiary"
                  commandFor="delete-photo"
                  command="--show"
                  onClick={() => setDeleting(photo.id)}
                >
                  Delete
                </s-button>
              )}
            </s-stack>
          ))}
        </s-stack>
        {editPhotos && (
          <>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              multiple
              onChange={onFiles}
              disabled={progress !== null}
            />
            {progress !== null && (
              <s-text>Uploading… {Math.round(progress * 100)}%</s-text>
            )}
          </>
        )}
      </s-stack>
      {confirmModal({
        id: "delete-photo",
        heading: "Delete this photo?",
        action: "Delete",
        onConfirm: () =>
          deleting && actions.run("delete-photo", { photoId: deleting }),
        text: "The photo is taken off the site and deleted for good.",
      })}
    </s-section>
  );
}

/** Private seller details: staff only. */
function Seller() {
  const { seller } = useLoaderData();
  return (
    <s-section heading="Seller (private)">
      <s-stack gap="small">
        <s-text>{seller.name}</s-text>
        <s-text>
          {seller.email}
          {seller.phone ? ` · ${seller.phone}` : ""}
        </s-text>
        <s-text>Invited for: {seller.itemSummary}</s-text>
        <s-text>
          Fee offered {dollars(seller.feeOfferedCents)} (listing fee{" "}
          {dollars(seller.feeRegularCents)})
        </s-text>
        <s-link href={`/app/invitations/${seller.invitationId}`}>
          Invitation
        </s-link>
      </s-stack>
    </s-section>
  );
}

/** Charges, paid periods and time adjustments: read-only. */
function Payments() {
  const { payments } = useLoaderData();
  const empty =
    payments.charges.length === 0 &&
    payments.periods.length === 0 &&
    payments.adjustments.length === 0;
  return (
    <s-section heading="Payments and time">
      {empty ? (
        <s-paragraph>Nothing charged yet.</s-paragraph>
      ) : (
        <s-stack gap="small">
          {payments.charges.map((charge) => (
            <s-text key={charge.id}>
              {day(charge.createdAt)} · {charge.kind} ·{" "}
              {dollars(charge.amountCents)} · {charge.status}
            </s-text>
          ))}
          {payments.periods.map((period) => (
            <s-text key={period.id}>
              Period {day(period.startsAt)} – {day(period.endsAt)}
            </s-text>
          ))}
          {payments.adjustments.map((adjustment) => (
            <s-text key={adjustment.id}>
              {when(adjustment.at)} ·{" "}
              {adjustment.type === "TECHNICAL_EXTENSION"
                ? "Extension"
                : "Investigation time restored"}{" "}
              · {Math.round((adjustment.minutes / 1440) * 10) / 10} days ·{" "}
              {adjustment.reason} · {adjustment.staff}
            </s-text>
          ))}
        </s-stack>
      )}
    </s-section>
  );
}

/** A confirmation modal for a destructive action; opened by a button with `commandFor={id}`. */
function confirmModal({ id, heading, action, onConfirm, text }) {
  return (
    <s-modal id={id} heading={heading}>
      <s-paragraph>{text}</s-paragraph>
      <s-button
        slot="primary-action"
        variant="primary"
        tone="critical"
        commandFor={id}
        command="--hide"
        onClick={onConfirm}
      >
        {action}
      </s-button>
      <s-button slot="secondary-actions" commandFor={id} command="--hide">
        Cancel
      </s-button>
    </s-modal>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
