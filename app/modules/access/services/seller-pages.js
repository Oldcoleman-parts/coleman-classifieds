// The storefront pages around a seller link, rendered inside the theme (Liquid). Every value
// is escaped, including `{` and `}` so seller text can never become Liquid.
// The listing page itself is the workspace module's; it uses `sellerLayout()` from here.

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

/**
 * JSON for an inline script: no `<`, so it can't close the tag, and no `{{` or `{%`, so Liquid
 * leaves it alone. Those pairs can only occur inside JSON strings, where `\u007b` is valid.
 * @param {unknown} value
 * @returns {string}
 */
export const scriptJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\{(?=[{%])/g, "\\u007b");

/** @param {string} token */
export const sellerPath = (token) => `${PROXY_PREFIX}/seller/${token}`;

/** The Get my link page (F04-T3); notifications checks `get_link_url` against the same path. */
export const MY_LINK_PATH = `${PROXY_PREFIX}/my-link`;

/**
 * @param {(body: string, init?: object) => Response} liquid
 * @param {string} title
 * @param {string} body
 * @param {number} [status]
 */
export function sellerLayout(liquid, title, body, status = 200) {
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
  DEADLINE: [
    "The deadline for this listing has passed",
    "Listings have to be sent for review by their deadline, so this link no longer opens it. Contact Old Coleman Parts if you’d still like to list your item.",
  ],
};

/**
 * @param {(body: string, init?: object) => Response} liquid
 * @param {"INVALID" | "EXPIRED" | "REVOKED" | "CLOSED"} state
 * @param {"DEADLINE"} [reason] from `resolveToken()`
 */
export function statePage(liquid, state, reason) {
  const [title, text] = STATE_PAGES[reason ?? state];
  return sellerLayout(liquid, title, `<p>${escapeHtml(text)}</p>`);
}

/** @param {(body: string, init?: object) => Response} liquid */
export function tooManyRequests(liquid) {
  return sellerLayout(
    liquid,
    "Please wait a moment",
    "<p>There have been too many requests. Try again in a few minutes.</p>",
    429,
  );
}

/**
 * The Get my link form.
 * @param {(body: string, init?: object) => Response} liquid
 * @param {{ siteKey: string, notice?: string, status?: number }} options
 */
export function myLinkForm(liquid, { siteKey, notice, status = 200 }) {
  return sellerLayout(
    liquid,
    "Get your private link",
    `${notice ? `<p role="status"><strong>${escapeHtml(notice)}</strong></p>` : ""}
<p>Enter the email address your invitation was sent to. We’ll email a new private link for each of your open listings. Each new link replaces the old one.</p>
<form method="post" action="${escapeHtml(MY_LINK_PATH)}">
<label for="cc-email">Your email address (Private)</label>
<input id="cc-email" type="email" name="email" autocomplete="email" maxlength="254" required style="display:block;width:100%;max-width:100%;margin:.25rem 0 1rem">
<div style="position:absolute;left:-10000px" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" style="margin-bottom:1rem"></div>
<button type="submit" class="button">Email my links</button>
</form>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`,
    status,
  );
}

/**
 * The same reply for every accepted request, whether or not the address is known.
 * @param {(body: string, init?: object) => Response} liquid
 */
export function myLinkSent(liquid) {
  return sellerLayout(
    liquid,
    "Check your email",
    "<p>If that address has open listings with us, we’ve emailed a new private link for each of them. Each new link replaces the old one, so please use the newest email.</p><p>Nothing arrived after a few minutes? Check your spam folder, or contact Old Coleman Parts.</p>",
  );
}

/** @param {string} invitationId the localStorage key of this invitation's device credential */
export const deviceStorageKey = (invitationId) => `cc_dev_${invitationId}`;

/**
 * Sends a stored device credential back to the page by POST, so private details are never
 * in a GET response. Does nothing when this device has none.
 */
function resumeScript(token, invitationId) {
  return `<form id="cc-resume" method="post" action="${escapeHtml(sellerPath(token))}" hidden><input type="hidden" name="device"></form>
<script>(function(){try{var k=${scriptJson(deviceStorageKey(invitationId))};var d=localStorage.getItem(k);if(!d)return;var f=document.getElementById("cc-resume");f.device.value=d;f.submit();}catch(e){}})();</script>`;
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
  return sellerLayout(
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
  return sellerLayout(
    liquid,
    "Thanks, you’re signed in",
    `<form id="cc-open" method="post" action="${escapeHtml(sellerPath(token))}"><input type="hidden" name="device" value="${escapeHtml(device)}"><button type="submit" class="button">Open my listing</button></form>
<script>(function(){try{localStorage.setItem(${scriptJson(deviceStorageKey(invitationId))},${scriptJson(device)});}catch(e){}document.getElementById("cc-open").submit();})();</script>`,
  );
}

/** p•••@example.com: enough for the seller to recognise, nothing more. */
function maskEmail(email) {
  const [user, domain] = String(email).split("@");
  return `${user.slice(0, 1)}•••@${domain ?? ""}`;
}
