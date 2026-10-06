// The browser script of the seller page: autosave, photo uploads and photo actions.
// DECISION (F04-T2): inlined into the Liquid page (no extra asset route). Media's browser
// helper is inlined with it, so uploads resize and report progress as on the staff screen.
import mediaClient from "@/modules/media/client.js?raw";
import { AppError } from "@/modules/core/index.js";

// Runs in the seller's browser. Reads the page data, fills in this device's credential, and
// sends every background call with the form token and the credential as headers.
const SELLER_SCRIPT = `
(function () {
  var dataEl = document.getElementById("cc-data");
  if (!dataEl) return;
  var data = JSON.parse(dataEl.textContent);
  var device = null;
  try { device = localStorage.getItem(data.deviceKey); } catch (e) {}
  document.querySelectorAll("input[data-cc-device]").forEach(function (input) {
    if (device) input.value = device;
  });

  async function call(path, body, extraHeaders) {
    var headers = Object.assign({ "X-CC-Form": data.formToken }, extraHeaders || {});
    if (device) headers["X-CC-Device"] = device;
    var response = await fetch(data.base + path, { method: "POST", headers: headers, body: body });
    var result = {};
    try { result = await response.json(); } catch (e) {}
    if (!response.ok || !result.ok) {
      var error = new Error(result.message || "Something went wrong. Please try again.");
      error.fields = result.fields || {};
      throw error;
    }
    return result;
  }

  var form = document.getElementById("cc-listing");
  var status = document.getElementById("cc-save-status");
  var timer = null;
  var saving = null;
  function say(element, text) { if (element) element.textContent = text; }

  async function save() {
    if (!form || !data.autosave) return;
    clearTimeout(timer);
    timer = null;
    say(status, "Saving…");
    try {
      await call("/draft", new FormData(form), { "X-CC-Autosave": "1" });
      say(status, "Draft saved.");
    } catch (error) {
      var problems = Object.values(error.fields || {});
      say(status, problems.length ? "Not saved yet: " + problems.join("; ") : error.message);
    }
  }

  if (form && data.autosave) {
    form.addEventListener("input", function (event) {
      if (event.target && event.target.type === "file") return;
      clearTimeout(timer);
      timer = setTimeout(function () { saving = save(); }, 1500);
    });
  }

  async function refresh() {
    if (timer) await save();
    else if (saving) await saving;
    var again = document.getElementById("cc-refresh");
    if (again) again.submit();
  }

  var photoStatus = document.getElementById("cc-photo-status");
  var input = document.getElementById("cc-photo-input");
  if (input) {
    input.addEventListener("change", async function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.disabled = true;
      for (var i = 0; i < files.length; i += 1) {
        var label = "Photo " + (i + 1) + " of " + files.length;
        try {
          await uploadPhoto(files[i], {
            getUploadUrl: async function (details) {
              var body = new URLSearchParams({ contentType: details.contentType, byteSize: String(details.byteSize) });
              return (await call("/upload-url", body)).upload;
            },
            complete: function (photoId) {
              return call("/upload-complete", new URLSearchParams({ photoId: photoId }));
            },
            onProgress: function (fraction) {
              say(photoStatus, label + ": " + Math.round(fraction * 100) + "%");
            },
          });
        } catch (error) {
          say(photoStatus, label + ": " + error.message);
          input.disabled = false;
          return;
        }
      }
      say(photoStatus, "Photos added.");
      await refresh();
    });
  }

  document.addEventListener("click", async function (event) {
    var target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return;
    var removeId = target.getAttribute("data-photo-delete");
    var upId = target.getAttribute("data-photo-up");
    if (!removeId && !upId) return;
    event.preventDefault();
    target.disabled = true;
    try {
      if (removeId) {
        if (!window.confirm("Remove this photo?")) { target.disabled = false; return; }
        await call("/photo-delete", new URLSearchParams({ photoId: removeId }));
      } else {
        var ids = Array.prototype.map.call(
          document.querySelectorAll("#cc-photo-list [data-photo-id]"),
          function (item) { return item.getAttribute("data-photo-id"); }
        );
        var at = ids.indexOf(upId);
        if (at > 0) { ids[at] = ids[at - 1]; ids[at - 1] = upId; }
        await call("/photo-order", new URLSearchParams(ids.map(function (id) { return ["photoIds", id]; })));
      }
      await refresh();
    } catch (error) {
      say(photoStatus, error.message);
      target.disabled = false;
    }
  });
})();
`;

// The media helper is an ES module; inside a classic script its exports are plain functions.
const MEDIA_HELPERS = mediaClient.replace(/^export\s+/gm, "");

const SCRIPT = `(function () {\n${MEDIA_HELPERS}\n${SELLER_SCRIPT}\n})();`;

/**
 * The inline script for the seller page. It sits inside `{% raw %}` and a `<script>` tag, so it
 * must never contain `{% endraw` or `</script`.
 * @returns {string}
 */
export function pageScript() {
  if (/\{%-?\s*endraw|<\/script/i.test(SCRIPT))
    throw new AppError("The seller page script can't be inlined safely", {
      code: "CONFIG",
    });
  return SCRIPT;
}
