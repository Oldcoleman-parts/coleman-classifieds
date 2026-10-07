// The storefront pages the app serves (Liquid responses). Every value is escaped, including
// `{` and `}` so seller text can never become Liquid.
// Every page is a standalone document (`layout: false`), never inside the theme: no theme
// script, analytics or pixel runs on a seller link (F04-FIX-2), and all app pages look the same.
// The listing page itself is the workspace module's; it uses `sellerLayout()` from here.

import { getEmailSettings } from "@/modules/notifications/index.js";

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

const SITE_NAME = "Old Coleman Parts";

// DECISION (F04-FIX-2): the standalone pages are styled to match the store's theme (navy,
// black rounded buttons, red accent, Inter with system fallbacks) from fixed values
// here, not from theme assets. No script, stylesheet or font is loaded from the theme or another
// origin; the only outside file is the logo image staff set in Settings → Emails.
// The page is still parsed as Liquid, so this must never contain `{{` or `{%`.
const SELLER_CSS = `*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body.cc-page{margin:0;min-height:100vh;display:flex;flex-direction:column;background:#f3f5f9;color:#3b3b3b;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
.cc-top{background:#fff}
.cc-top-in{max-width:44rem;margin:0 auto;padding:.75rem 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem}
.cc-brand{display:flex;align-items:center;gap:.75rem;min-width:0;color:#0f2d58;font-weight:700;font-size:1.125rem;letter-spacing:-.01em;text-decoration:none}
.cc-logo{display:block;height:52px;width:auto;max-width:11rem;object-fit:contain}
.cc-badge{flex:none;padding:.3rem .8rem;border-radius:999px;background:#c0252a;color:#fff;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.cc-main{flex:1}
.cc-hero{background:linear-gradient(135deg,#0f2d58 0%,#173f78 100%);color:#fff;padding:2rem 1.25rem 4.5rem}
.cc-hero-in{max-width:44rem;margin:0 auto;padding:0 1.25rem}
.cc-eyebrow{display:flex;align-items:center;gap:.6rem;margin:0 0 .6rem;color:#c9d6ea;font-size:.78rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase}
.cc-eyebrow::before{content:"";width:1.75rem;height:3px;border-radius:2px;background:#c0252a}
.cc-hero h1{margin:0;color:#fff;font-size:2rem;line-height:1.15;letter-spacing:-.02em}
.cc-wrap{width:100%;max-width:44rem;margin:-3rem auto 0;padding:0 1.25rem 2.5rem}
.cc-seller{background:#fff;border:1px solid #e3e7ee;border-radius:18px;padding:2rem;box-shadow:0 16px 40px rgba(15,45,88,.12)}
.cc-seller>:first-child{margin-top:0}
.cc-seller>:last-child{margin-bottom:0}
.cc-seller h2{color:#0f2d58;font-size:1.25rem;line-height:1.3;margin:1.75rem 0 .75rem}
.cc-seller h3,.cc-seller legend{color:#0f2d58}
.cc-seller p{margin:0 0 1rem}
.cc-seller a{color:#0f2d58;font-weight:600;text-underline-offset:2px}
.cc-seller a:hover{color:#c0252a}
.cc-seller img{max-width:100%;height:auto}
.cc-seller label{display:block;font-weight:600;color:#1f2a3a;margin:.75rem 0 .3rem}
.cc-seller input,.cc-seller textarea,.cc-seller select{font:inherit;font-size:16px;color:#222;max-width:100%}
.cc-seller input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]),.cc-seller textarea,.cc-seller select{display:block;width:100%;padding:.7rem .85rem;border:1px solid #c5ccd8;border-radius:8px;background:#fff;transition:border-color .15s,box-shadow .15s}
.cc-seller input:not([type=checkbox]):not([type=radio]):not([type=file]):focus,.cc-seller textarea:focus,.cc-seller select:focus{outline:none;border-color:#0f2d58;box-shadow:0 0 0 3px rgba(15,45,88,.18)}
.cc-seller input[type=checkbox],.cc-seller input[type=radio]{width:1.2rem;height:1.2rem;margin-right:.35rem;vertical-align:-.2rem;accent-color:#0f2d58}
.cc-seller input[type=file]{width:100%;padding:.85rem;border:1px dashed #b3bccb;border-radius:10px;background:#f8fafc}
.cc-seller .button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:.65rem 1.6rem;margin-top:.75rem;border:1px solid #000;border-radius:14px;background:#000;color:#fff;font:inherit;font-weight:600;cursor:pointer;transition:background .15s,transform .05s,box-shadow .15s}
.cc-seller .button:hover{background:#0f2d58;border-color:#0f2d58;box-shadow:0 6px 16px rgba(15,45,88,.22)}
.cc-seller .button:active{transform:translateY(1px)}
.cc-seller .button[type=button]{background:#fff;color:#000;min-height:40px;padding:.4rem 1rem;font-size:.9rem;margin-top:0}
.cc-seller .button[type=button]:hover{background:#f3f5f9;color:#0f2d58;box-shadow:none}
.cc-seller .button[disabled]{opacity:.45;cursor:not-allowed;box-shadow:none}
.cc-seller :focus-visible{outline:3px solid rgba(15,45,88,.55);outline-offset:2px}
.cc-seller [role=status]{padding:.85rem 1rem;border-left:4px solid #c0252a;border-radius:8px;background:#fdf3f2}
.cc-foot{max-width:44rem;width:100%;margin:0 auto;padding:0 1.25rem 2rem;display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5rem;color:#6b7686;font-size:.875rem}
.cc-foot a{color:#0f2d58;font-weight:600;text-decoration:none}
.cc-foot a:hover{text-decoration:underline}
@media(max-width:560px){.cc-top-in{padding:.6rem 1rem}.cc-logo{height:44px;max-width:9rem}.cc-hero{padding:1.5rem 0 4rem}.cc-hero-in{padding:0 1rem}.cc-hero h1{font-size:1.6rem}.cc-wrap{padding:0 .75rem 1.5rem}.cc-seller{padding:1.4rem 1.1rem;border-radius:14px}.cc-seller .button:not([type=button]){width:100%}.cc-foot{padding:0 1rem 1.5rem}}
@media(prefers-reduced-motion:reduce){.cc-seller .button,.cc-seller input,.cc-seller textarea{transition:none}}`;

/**
 * Every app page: a complete document outside the theme (`{% layout none %}`), with no theme
 * assets. No script or stylesheet comes from another origin on a token page; only the Get my
 * link form adds the Turnstile script. The header shows the logo from Settings → Emails, or
 * the store name when none is set.
 * @param {(body: string, init?: object) => Response} liquid
 * @param {string} title
 * @param {string} body
 * @param {number} [status]
 * @returns {Promise<Response>}
 */
export async function sellerLayout(liquid, title, body, status = 200) {
  const { logoUrl, senderName } = await getEmailSettings();
  const brand = logoUrl
    ? `<img class="cc-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(senderName || SITE_NAME)}" referrerpolicy="no-referrer">`
    : SITE_NAME;
  return liquid(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} | ${SITE_NAME} Classifieds</title>
<style>${SELLER_CSS}</style>
</head>
<body class="cc-page">
<header class="cc-top"><div class="cc-top-in"><a class="cc-brand" href="/">${brand}</a><span class="cc-badge">Classifieds</span></div></header>
<main class="cc-main">
<div class="cc-hero"><div class="cc-hero-in"><p class="cc-eyebrow">Private seller classifieds</p><h1>${escapeHtml(title)}</h1></div></div>
<div class="cc-wrap"><div class="cc-seller">
${body}
</div></div>
</main>
<footer class="cc-foot"><span>${SITE_NAME} Classifieds</span><a href="/">Back to the store</a></footer>
</body>
</html>`,
    {
      layout: false,
      status,
      headers: {
        "Referrer-Policy": "no-referrer",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
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
