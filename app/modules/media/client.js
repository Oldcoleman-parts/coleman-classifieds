// Browser-only helpers for the seller and staff photo screens. No server imports here: the
// screens import this file directly, not `index.js`.

const RESIZABLE = ["image/jpeg", "image/png", "image/webp"];

/**
 * Shrink a photo in the browser before upload, so phone photos upload quickly. A file the
 * browser can't draw (HEIC outside Safari, for example) is returned unchanged; the server
 * converts it.
 * @param {File} file
 * @param {{ maxEdge?: number, quality?: number }} [options]
 * @returns {Promise<Blob>} a JPEG, or the original file
 */
export async function resizeImage(
  file,
  { maxEdge = 2560, quality = 0.85 } = {},
) {
  if (!RESIZABLE.includes(file.type)) return file;
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  // A small JPEG gains nothing from being drawn again.
  if (scale === 1 && file.type === "image/jpeg") {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  return blob ?? file;
}

/**
 * Send a file to an upload link, reporting progress.
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {Blob} body
 * @param {{ onProgress?: (fraction: number) => void, signal?: AbortSignal }} options
 * @returns {Promise<void>}
 */
function put(url, headers, body, { onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers))
      request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error("The photo could not be uploaded"));
    request.onerror = () =>
      reject(new Error("The photo could not be uploaded"));
    request.onabort = () =>
      reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(body);
  });
}

/**
 * Resize and upload one photo. The screen supplies the two server calls, so this works for
 * the seller pages (app proxy) and the staff pages (admin) alike.
 * @template T
 * @param {File} file
 * @param {object} options
 * @param {(input: { contentType: string, byteSize: number }) => Promise<{ photoId: string, url: string, headers: Record<string, string> }>} options.getUploadUrl
 *   asks the server for an upload link
 * @param {(photoId: string) => Promise<T>} options.complete tells the server the upload is done
 * @param {(fraction: number) => void} [options.onProgress] 0 to 1
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<T>} what `complete` returned
 */
export async function uploadPhoto(
  file,
  { getUploadUrl, complete, onProgress, signal },
) {
  const body = await resizeImage(file);
  const contentType = body.type || file.type;
  const { photoId, url, headers } = await getUploadUrl({
    contentType,
    byteSize: body.size,
  });
  await put(url, headers, body, { onProgress, signal });
  onProgress?.(1);
  return complete(photoId);
}
