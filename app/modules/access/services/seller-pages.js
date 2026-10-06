// The storefront pages around a seller link, rendered inside the theme (Liquid). Every value
// is escaped, including `{` and `}` so seller text can never become Liquid.
// F04-T2 replaces `listingPlaceholder()` with the real seller page.

export const PROXY_PREFIX = "/apps/classifieds";

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "{": "&#123;",
  "}": "&#125;",
  "%": "&#37;",
};

/** @param {unknown} value */
export const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"'{}%]/g, (char) => ESCAPES[char]);

/** JSON for an inline script: no `<`, so it can't close the tag. */
const scriptJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

/** @param {string} token */
export const sellerPath = (token) => `${PROXY_PREFIX}/seller/${token}`;

/**
 * @param {(body: string, init?: object) => Response} liquid
 * @param {string} title
 * @param {string} body
 * @param {number} [status]
 */
function page(liquid, title, body, status = 200) {
  return liquid(
    `<meta name="referrer" content="no-referrer">
<div class="cc-seller page-width" style="max-width:40rem;margin:2rem auto;padding:0 1rem">
<h1>${escapeHtml(title)}</h1>
${body}
</div>`,
    {
      status,
      headers: {
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
      },
    },
  );
}

const STATE_PAGES = {
  INVALID: [
    "This link doesn’t work",
    "Check that you copied the whole link from your invitation email. If it still doesn’t open, contact Old Coleman Parts for a new one.",
  ],
  EXPIRED: [
    "This invitation has expired",
    "Invitation links last a limited time. Contact Old Coleman Parts if you’d still like to list your item.",
  ],
  REVOKED: [
    "This invitation was withdrawn",
    "Contact Old Coleman Parts if you think this is a mistake.",
  ],
  CLOSED: [
    "This listing has ended",
    "This link no longer opens a listing. Contact Old Coleman Parts if you have a question.",
  ],
};

/**
 * @param {(body: string, init?: object) => Response} liquid
 * @param {"INVALID" | "EXPIRED" | "REVOKED" | "CLOSED"} state
 */
export function statePage(liquid, state) {
  const [title, text] = STATE_PAGES[state];
  return page(liquid, title, `<p>${escapeHtml(text)}</p>`);
}

/** @param {(body: string, init?: object) => Response} liquid */
export function tooManyRequests(liquid) {
  return page(
    liquid,
    "Please wait a moment",
    "<p>There have been too many requests. Try again in a few minutes.</p>",
    429,
  );
}

const deviceKey = (invitationId) => `cc_dev_${invitationId}`;

/**
 * Sends a stored device credential back to the page by POST, so private details are never
 * in a GET response. Does nothing when this device has none.
 */
function resumeScript(token, invitationId) {
  return `<form id="cc-resume" method="post" action="${escapeHtml(sellerPath(token))}" hidden><input type="hidden" name="device"></form>
<script>(function(){try{var k=${scriptJson(deviceKey(invitationId))};var d=localStorage.getItem(k);if(!d)return;var f=document.getElementById("cc-resume");f.device.value=d;f.submit();}catch(e){}})();</script>`;
}

/**
 * The "email me a code" and "enter the code" forms.
 * @param {(body: string, init?: object) => Response} liquid
 * @param {{ token: string, invitation: { id: string, sellerEmail: string }, notice?: string, resume?: boolean }} options
 */
export function codePage(
  liquid,
  { token, invitation, notice, resume = false },
) {
  const base = sellerPath(token);
  const masked = maskEmail(invitation.sellerEmail);
  return page(
    liquid,
    "Confirm it’s you",
    `${notice ? `<p role="status"><strong>${escapeHtml(notice)}</strong></p>` : ""}
<p>To open your listing on this device, we’ll email a 6-digit code to ${escapeHtml(masked)}.</p>
<form method="post" action="${escapeHtml(`${base}/code-request`)}">
<div style="position:absolute;left:-10000px" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<button type="submit" class="button">Email me a code</button>
</form>
<form method="post" action="${escapeHtml(`${base}/code-verify`)}" style="margin-top:1.5rem">
<label for="cc-code">Code from the email</label>
<input id="cc-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
<button type="submit" class="button">Continue</button>
</form>
${resume ? resumeScript(token, invitation.id) : ""}`,
  );
}

/**
 * After a correct code: keep the device credential in this browser, then open the listing.
 * @param {(body: string, init?: object) => Response} liquid
 * @param {{ token: string, invitationId: string, device: string }} options
 */
export function verifiedPage(liquid, { token, invitationId, device }) {
  return page(
    liquid,
    "Thanks, you’re signed in",
    `<form id="cc-open" method="post" action="${escapeHtml(sellerPath(token))}"><input type="hidden" name="device" value="${escapeHtml(device)}"><button type="submit" class="button">Open my listing</button></form>
<script>(function(){try{localStorage.setItem(${scriptJson(deviceKey(invitationId))},${scriptJson(device)});}catch(e){}document.getElementById("cc-open").submit();})();</script>`,
  );
}

/**
 * The seller's listing page. A placeholder until F04-T2.
 * @param {(body: string, init?: object) => Response} liquid
 * @param {{ invitation: { sellerName: string, itemSummary: string, feeOfferedCents: number } }} options
 */
export function listingPlaceholder(liquid, { invitation }) {
  const fee = (invitation.feeOfferedCents / 100).toFixed(2);
  return page(
    liquid,
    "Your listing",
    `<p>Hello ${escapeHtml(invitation.sellerName.split(/\s+/)[0])}, this is the private page for your listing of <strong>${escapeHtml(invitation.itemSummary)}</strong>.</p>
<p>Listing fee: $${escapeHtml(fee)} for one month. You’re only charged after staff approve your listing.</p>
<p>The listing form is coming soon.</p>`,
  );
}

/** p•••@example.com: enough for the seller to recognise, nothing more. */
function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  return `${user.slice(0, 1)}•••@${domain ?? ""}`;
}
