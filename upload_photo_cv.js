/* ============================================================
   MECULS — upload_photo_cv.js
   Photo and CV upload logic, validation, and navigation.
   Communicates with parent dashboard via postMessage.

   Shared helpers (showPopup, showToast, setLoading) come from
   mc_helpers.js (MC.* namespace) — see <script src="mc_helpers.js">
   in upload_photo_cv.html.
   ============================================================ */

"use strict";

/* Phase 1 Step 3 build marker — verify in console with:
   window.UPLOAD_PHOTO_CV_VERSION
   "phase1-step3-cv-links" means CV file upload is replaced with
   per-domain CV links (Google Drive / OneDrive / Dropbox URLs). */
window.UPLOAD_PHOTO_CV_VERSION = "phase1-step3-cv-links-confirm-fix";

/* ── Validation constants ── */
/* PHOTO config (Phase 1 Step 2 + Step 3 — hard 15 KB ceiling):
   - INPUT_MIN_BYTES / INPUT_MAX_BYTES: bounds on the RAW upload
     (user-facing 100 KB – 5 MB rule)
   - MIN_PX / INPUT_MAX_PX: bounds on the SOURCE photo's pixel dimensions.
     MIN_PX guards face visibility. INPUT_MAX_PX is a defensive guard only
     (canvas allocation crashes on enormous images) — real phone photos
     are well below it.
   - HARD_MAX_BYTES: ABSOLUTE ceiling on the final stored photo (15 KB).
     Capacity math: 1 GB free Storage ÷ 15 KB ≈ 70,000 photos, well past
     the 50,000-user DB ceiling. Founder requirement: never exceed this.
   - COMPRESS_ATTEMPTS: tried in order. Each is { px, q }. Compression
     stops at the first attempt that fits under HARD_MAX_BYTES. We try
     smaller dimensions first (preserves quality), then drop quality on
     a smaller canvas only if needed.
   - COMFORT_QUALITY_THRESHOLD: 0.60. If the winning attempt's quality
     was below this, the photo had to be compressed strongly — we show
     a friendly hint about plain backgrounds.
   - PREFERRED_FORMAT / FALLBACK_FORMAT: WebP first, JPEG fallback for
     very old browsers (pre-iOS 14 Safari) that cannot encode WebP. */
const PHOTO = {
  INPUT_MIN_BYTES     : 100 * 1024,       // 100 KB raw input floor (user-facing rule)
  INPUT_MAX_BYTES     : 5 * 1024 * 1024,  // 5 MB raw input ceiling (user-facing rule)
  MIN_BYTES           : 3 * 1024,         // 3 KB final (sanity floor — encoder produced something)
  HARD_MAX_BYTES      : 15 * 1024,        // 15 KB HARD ceiling — never exceed
  MIN_PX              : 400,
  /* Three-tier pixel cap (Phase 1 Step 2 + screenshot-feedback round):
     - SAFE_MAX_PX (5000): photo fits the cascade directly, no preprocessing
     - PREPROCESS_MAX_PX (12000): photo gets DOWNSCALED to PREPROCESS_TARGET_PX
       on the LONG edge BEFORE the compression cascade runs (handles real
       DSLRs, large phone photos, scanned images). User never sees an error.
     - Anything beyond PREPROCESS_MAX_PX is REJECTED — it's either a "pixel
       bomb" attack (small file, huge canvas) or an absurdly extreme input
       that would crash the user's browser.
     Modern phones (iPhone 16 Pro Max, Galaxy S24 Ultra) max out around
     8000×6000, well within PREPROCESS_MAX_PX. */
  SAFE_MAX_PX         : 5000,
  PREPROCESS_MAX_PX   : 12000,
  PREPROCESS_TARGET_PX: 4000,             // long-edge target after preprocessing
  /* Cascade: try larger/higher-quality first, fall back to smaller/lower. */
  COMPRESS_ATTEMPTS   : [
    { px: 400, q: 0.72 },   // attempt 1: best case (plain backgrounds usually fit here)
    { px: 320, q: 0.70 },   // attempt 2: shrink dimensions, keep quality
    { px: 280, q: 0.70 },   // attempt 3: smaller still
    { px: 280, q: 0.60 },   // attempt 4: now drop quality
    { px: 240, q: 0.55 },   // attempt 5: smaller + lower quality
    { px: 200, q: 0.50 }    // attempt 6: minimum acceptable
  ],
  COMFORT_QUALITY_THRESHOLD : 0.60,       // below this, show "consider simpler photo" hint
  PREFERRED_FORMAT    : "image/webp",
  FALLBACK_FORMAT     : "image/jpeg",
  TYPES               : ["image/jpeg", "image/png"]
};

/* ── CV LINKS config (Phase 1 Step 3 — replaces CV file upload) ──
   Users provide URLs to CV documents in Google Drive / OneDrive / Dropbox
   instead of uploading files. This:
   - Frees Supabase Storage (1 GB) entirely for photos → ~70k user capacity
   - Lets users have multiple CVs (one per domain) — better matching
   - Removes file-format/scanning concerns (their cloud handles it)

   What we cannot do: actually fetch/verify the link works. Browsers can't
   bypass CORS to test Drive/Dropbox URLs, and serverless fetching from
   Supabase free tier is unreliable (Drive blocks bot IPs). Best-effort
   protections: format validation, double-confirmation popup, "test in
   incognito" instruction, open-in-new-tab button per row. */
const CV_LINKS_MAX = 6;
const CV_DOMAINS = [
  "Human Resources (HR)",
  "Recruitment & Talent Acquisition",
  "Research & Analytics",
  "Market Research",
  "Data Analytics",
  "Artificial Intelligence & Machine Learning",
  "Software Engineering",
  "Product Management",
  "Design (UX / UI / Graphic)",
  "Sales",
  "Marketing & Branding",
  "Finance & Accounting",
  "Operations & Supply Chain",
  "Legal",
  "Consulting & Strategy",
  "Customer Support & Success",
  "Healthcare & Medical",
  "Education & Training",
  "Content & Communications",
  "Engineering (Mechanical / Civil / Electrical)",
  "Other (please specify)"
];

/* Per-domain placeholder hints for the sub-domain field.
   Sub-domain is FREE TEXT (intentionally — see plan: dropdown of 200
   sub-domains is unmaintainable, free text + helpful examples wins). */
const CV_SUBDOMAIN_PLACEHOLDERS = {
  "Human Resources (HR)"                              : "e.g. Compensation, L&D, Employee Relations",
  "Recruitment & Talent Acquisition"                  : "e.g. Tech Hiring, Executive Search, Campus",
  "Research & Analytics"                              : "e.g. Quantitative, Qualitative, Mixed Methods",
  "Market Research"                                   : "e.g. Consumer Insights, B2B, Pricing Research",
  "Data Analytics"                                    : "e.g. Healthcare Analytics, Marketing Analytics",
  "Artificial Intelligence & Machine Learning"        : "e.g. NLP, Computer Vision, MLOps",
  "Software Engineering"                              : "e.g. Backend, Frontend, Mobile, DevOps",
  "Product Management"                                : "e.g. SaaS, Consumer, Platform, Growth",
  "Design (UX / UI / Graphic)"                        : "e.g. Mobile UX, Brand Design, Motion",
  "Sales"                                             : "e.g. Enterprise, Inside Sales, Channel",
  "Marketing & Branding"                              : "e.g. Digital, Brand, Performance, Content",
  "Finance & Accounting"                              : "e.g. FP&A, Audit, Tax, Treasury",
  "Operations & Supply Chain"                         : "e.g. Manufacturing, Logistics, Procurement",
  "Legal"                                             : "e.g. Corporate, IP, Litigation, Compliance",
  "Consulting & Strategy"                             : "e.g. Strategy, Operations, Tech Consulting",
  "Customer Support & Success"                        : "e.g. CSM, Technical Support, Training",
  "Healthcare & Medical"                              : "e.g. Clinical, Pharma, MedTech, Public Health",
  "Education & Training"                              : "e.g. K-12, Higher Ed, Corporate Training",
  "Content & Communications"                          : "e.g. Editorial, Tech Writing, PR",
  "Engineering (Mechanical / Civil / Electrical)"     : "e.g. Mechanical, Civil, Electrical, Aerospace",
  "Other (please specify)"                            : "e.g. your specialisation"
};

/* Supported cloud-storage providers. Anything else is rejected with a
   clear message naming the user's hostname so they know what to fix. */
const CV_PROVIDERS = {
  "drive.google.com": { provider: "google_drive", label: "Google Drive" },
  "docs.google.com" : { provider: "google_drive", label: "Google Drive" },
  "onedrive.live.com": { provider: "onedrive",    label: "OneDrive" },
  "1drv.ms"          : { provider: "onedrive",    label: "OneDrive" },
  "dropbox.com"      : { provider: "dropbox",     label: "Dropbox" },
  "db.tt"            : { provider: "dropbox",     label: "Dropbox" }
};

/* URL fragments that indicate a FOLDER (not a single document).
   We reject these so admin always lands on one file when clicking. */
const CV_FOLDER_PATTERNS = [
  /^\/drive\/folders\//i,        // Google Drive folder
  /^\/drive\/u\/\d+\/folders\//i,// Google Drive folder (alt path with user index)
  /^\/scl\/fo\//i,               // Dropbox folder (modern shared link)
  /^\/sh\//i                     // Dropbox shared folder (legacy)
];

/* ── Shared helpers from mc_helpers.js (MC.* namespace) ── */
const showPopup  = MC.showPopup;
const showToast  = MC.showToast;
const setLoading = MC.setLoading;

/* ── DOM refs ── */
const photoDropzone  = document.getElementById("photoDropzone");
const photoInput     = document.getElementById("photoInput");
const photoPreview   = document.getElementById("photoPreview");
const photoPlaceholder = document.getElementById("photoPlaceholder");
const photoChangeLink = document.getElementById("photoChangeLink");
const photoError     = document.getElementById("photoError");
const photoSuccess   = document.getElementById("photoSuccess");

const cvRowsContainer = document.getElementById("cvRowsContainer");
const addCvDomainBtn  = document.getElementById("addCvDomainBtn");
const cvCountHint     = document.getElementById("cvCountHint");
const cvLinksError    = document.getElementById("cvLinksError");

const saveBtn        = document.getElementById("saveContinueBtn");

/* ── Inline error / success display helpers (page-specific —
     these target the field-error / field-success divs under each
     dropzone, not the global toast/popup, so they stay local) ── */
function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}

function hideError(el) {
  el.classList.add("hidden");
  el.textContent = "";
}

function showSuccess(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}

/* Format a byte count as a friendly string (e.g. "248 KB", "0.92 MB").
   Used in the upload-success messages so users have a clear sense of
   how close they are to the 1 MB cap. */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

/* ============================================================
   PHOTO UPLOAD
   ============================================================ */

/* Click to open file picker */
photoDropzone.addEventListener("click", () => photoInput.click());

/* Keyboard accessibility */
photoDropzone.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") photoInput.click();
});

/* Drag events */
photoDropzone.addEventListener("dragover", e => {
  e.preventDefault();
  photoDropzone.classList.add("dragover");
});

photoDropzone.addEventListener("dragleave", () => {
  photoDropzone.classList.remove("dragover");
});

photoDropzone.addEventListener("drop", e => {
  e.preventDefault();
  photoDropzone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) handlePhoto(file);
});

photoInput.addEventListener("change", e => {
  const file = e.target.files[0];
  if (file) handlePhoto(file);
});

/* Change-photo link below the circle. Clicking opens the file
   picker (same as clicking the circle itself). The link is
   hidden by default and revealed by finalizePhoto() once a
   photo has been uploaded. */
if (photoChangeLink) {
  photoChangeLink.addEventListener("click", () => photoInput.click());
}

function handlePhoto(file) {
  hideError(photoError);
  hideError(photoSuccess);

  /* Type check */
  if (!PHOTO.TYPES.includes(file.type)) {
    showError(photoError, "Please upload a JPG or PNG image.");
    return;
  }

  /* Hard cap on raw input size — anything beyond 5 MB is rejected
     to protect the browser from running out of memory while we
     try to compress it. Phone photos are typically 2–4 MB. */
  if (file.size > PHOTO.INPUT_MAX_BYTES) {
    showError(photoError,
      "This photo is " + formatFileSize(file.size) + ", which is more than 5 MB. " +
      "Photos must be between 100 KB and 5 MB. Please pick a different photo."
    );
    return;
  }

  /* Floor on raw input size — anything under 100 KB is rejected
     because tiny source files have too little detail for our
     compressor to produce a clean 400×400 output. */
  if (file.size < PHOTO.INPUT_MIN_BYTES) {
    showError(photoError,
      "This photo is " + formatFileSize(file.size) + ", which is less than 100 KB. " +
      "Photos must be between 100 KB and 5 MB. Please pick a different photo."
    );
    return;
  }

  /* Read the file. We need pixel dimensions before we can compress. */
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      /* Reject too-small photos — these have nothing for compression
         to optimise. Respect the same minimum we always had. */
      if (img.width < PHOTO.MIN_PX || img.height < PHOTO.MIN_PX) {
        showError(photoError,
          `Photo must be at least ${PHOTO.MIN_PX} × ${PHOTO.MIN_PX} pixels. ` +
          `Yours is ${img.width} × ${img.height}.`
        );
        return;
      }
      /* HARD REJECT — pixel bombs / absurd inputs. Anything beyond
         12000×12000 (PREPROCESS_MAX_PX) would either crash the user's
         browser canvas allocator or is a deliberate "pixel bomb" attack
         (small file, huge canvas). Real DSLRs and phones never hit this. */
      if (img.width > PHOTO.PREPROCESS_MAX_PX || img.height > PHOTO.PREPROCESS_MAX_PX) {
        showError(photoError,
          `This photo's dimensions (${img.width} × ${img.height} pixels) are too large to process safely. ` +
          `Please pick a regular phone or camera photo &mdash; modern phones produce photos well below this size.`
        );
        return;
      }

      /* AUTO-DOWNSCALE the source if it's bigger than SAFE_MAX_PX but
         below PREPROCESS_MAX_PX. We draw it onto a smaller canvas first
         (long-edge = PREPROCESS_TARGET_PX = 4000), then feed THAT into
         the regular compression cascade. The user never sees an error;
         this just runs silently. Without this preprocessing step, a
         9000×6000 phone photo would force the cascade to allocate a
         huge canvas on each attempt, slow on low-end devices. */
      let workingImg = img;
      const longEdge = Math.max(img.width, img.height);
      if (longEdge > PHOTO.SAFE_MAX_PX) {
        try {
          const scale = PHOTO.PREPROCESS_TARGET_PX / longEdge;
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const pre = document.createElement("canvas");
          pre.width = w;
          pre.height = h;
          const pctx = pre.getContext("2d");
          pctx.drawImage(img, 0, 0, w, h);
          /* Replace the image with a downscaled clone for the cascade */
          const preDataUrl = pre.toDataURL("image/jpeg", 0.92);
          const preImg = new Image();
          preImg.onload = () => {
            runCompression(preImg, file.size);
          };
          preImg.onerror = () => {
            /* Fallback: cascade on the original if preprocessing fails */
            console.warn("[photo] preprocess image-load failed; falling back to original");
            runCompression(img, file.size);
          };
          preImg.src = preDataUrl;
          return;  /* runCompression will be called from preImg.onload */
        } catch (e) {
          /* Canvas operations failed — likely OOM. Reject with friendly msg. */
          console.warn("[photo] preprocess canvas failed:", e);
          showError(photoError,
            "Your browser couldn't process this photo. Please pick a smaller photo or a regular phone camera shot."
          );
          return;
        }
      }
      /* Photo is within SAFE_MAX_PX — go straight to the cascade. */
      runCompression(workingImg, file.size);

      /* Inner: actually run the compression cascade and handle results.
         Extracted as a closure so both the preprocess and direct paths
         can call it. */
      function runCompression(sourceImg, originalBytes) {
      compressImage(sourceImg, originalBytes).then(result => {
        if (!result) {
          /* Every cascade attempt exceeded the 15 KB ceiling. This is
             rare — only happens with extremely complex photos. Tell the
             user clearly what kind of photo will work. */
          showError(photoError,
            "We could not compress this photo to fit our 15 KB size limit while keeping it readable. " +
            "Please try a different photo: ideally a portrait of you against a plain or single-colour " +
            "background, with even lighting and no busy patterns or crowds in the frame."
          );
          return;
        }
        /* Sanity check: encoder must have produced something real.
           Anything below MIN_BYTES usually means an empty/corrupt buffer. */
        if (result.size < PHOTO.MIN_BYTES) {
          showError(photoError,
            "Could not optimise this photo. Please try a different one."
          );
          return;
        }
        /* compressImage already guaranteed result.size ≤ HARD_MAX_BYTES,
           so no upper-bound check is needed here. */
        finalizePhoto(result.dataUrl, file.size, result.size,
                      result.width, result.height, true,
                      !!result.heavilyCompressed);
      }).catch(err => {
        console.error("[photo] compression failed:", err);
        showError(photoError,
          "Could not optimise this photo. Please try a different one."
        );
      });
      }  /* end runCompression */
    };
    img.onerror = () => {
      showError(photoError, "Could not read this image. Please try a different file.");
    };
    img.src = ev.target.result;
  };
  reader.onerror = () => {
    showError(photoError, "Could not read this file. Please try again.");
  };
  reader.readAsDataURL(file);
}

/* ============================================================
   COMPRESS — resize via canvas + re-encode.

   Phase 1 Step 2 changes:
   - Output is WebP (~30% smaller than JPEG at same visual quality)
   - Fallback to JPEG at slightly lower quality if WebP unsupported
     (very old Safari, pre-iOS 14)
   - Target dimension dropped from 1200 px to 400 px

   Resolves to { dataUrl, size, width, height, format } or null.
   ============================================================ */
/* ── Internal: do ONE compression attempt at given dimension and quality.
   Returns { dataUrl, size, width, height, format, qualityUsed } or null. */
function compressImageOnce(img, targetMaxPx, qualityRequested) {
  /* Calculate target dimensions preserving aspect ratio */
  let targetW = img.width;
  let targetH = img.height;
  if (targetW > targetMaxPx || targetH > targetMaxPx) {
    if (targetW >= targetH) {
      targetH = Math.round(targetH * (targetMaxPx / targetW));
      targetW = targetMaxPx;
    } else {
      targetW = Math.round(targetW * (targetMaxPx / targetH));
      targetH = targetMaxPx;
    }
  }

  /* Draw to canvas */
  let canvas;
  try {
    canvas = document.createElement("canvas");
    canvas.width  = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, targetW, targetH);
  } catch (err) {
    console.error("[photo] canvas draw failed:", err);
    return null;
  }

  /* Encode: WebP first, fall back to JPEG. canvas.toDataURL with an
     unsupported format silently returns PNG instead of throwing — we
     detect that by checking the MIME prefix. */
  let dataUrl, format, qualityUsed;
  try {
    dataUrl = canvas.toDataURL(PHOTO.PREFERRED_FORMAT, qualityRequested);
    if (dataUrl && dataUrl.indexOf("data:" + PHOTO.PREFERRED_FORMAT) === 0) {
      format      = PHOTO.PREFERRED_FORMAT;
      qualityUsed = qualityRequested;
    } else {
      /* Browser doesn't support WebP. Fall back to JPEG at slightly
         lower quality so file size is comparable. */
      const jpegQ = Math.max(qualityRequested - 0.07, 0.40);
      dataUrl = canvas.toDataURL(PHOTO.FALLBACK_FORMAT, jpegQ);
      format  = PHOTO.FALLBACK_FORMAT;
      qualityUsed = jpegQ;
    }
  } catch (err) {
    console.error("[photo] toDataURL failed:", err);
    return null;
  }

  /* Estimate file size from the data URL.
     Base64 overhead ~4/3, so size ≈ (length-of-base64) × 0.75 */
  const base64 = (dataUrl || "").split(",")[1] || "";
  const size   = Math.round(base64.length * 0.75);

  return { dataUrl, size, width: targetW, height: targetH, format, qualityUsed };
}

/* ============================================================
   COMPRESS — cascade through PHOTO.COMPRESS_ATTEMPTS until the
   result fits HARD_MAX_BYTES. Returns the FIRST attempt that fits.

   Phase 1 Step 3 — hard 15 KB ceiling.
   Try larger/higher-quality first; only step down if needed. So a
   simple photo (plain background) wins on attempt 1 with the best
   visual fidelity. A complex photo (busy/textured) cascades down
   until it fits, accepting some quality loss to honour the ceiling.

   Returns { dataUrl, size, width, height, format, qualityUsed }
   from the first passing attempt, or null if EVERY attempt exceeds
   the ceiling (extremely unlikely with the smallest 200×200 q0.50
   step but defensively handled).
   ============================================================ */
function compressImage(img, originalSize) {
  return new Promise((resolve) => {
    const attempts = PHOTO.COMPRESS_ATTEMPTS;
    let lastResult = null;

    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      const r = compressImageOnce(img, a.px, a.q);
      if (!r) continue;
      lastResult = r;
      if (r.size <= PHOTO.HARD_MAX_BYTES) {
        /* Found one that fits. Mark whether this required strong
           compression (quality below the comfort threshold) so the UI
           can show the "consider simpler photo" hint. */
        r.heavilyCompressed = (r.qualityUsed < PHOTO.COMFORT_QUALITY_THRESHOLD);
        resolve(r);
        return;
      }
    }

    /* Every attempt exceeded HARD_MAX_BYTES. Return null so the caller
       can show a clear error asking for a different photo. */
    console.warn("[photo] all compression attempts exceeded ceiling. Last size:",
                 lastResult ? lastResult.size : "n/a");
    resolve(null);
  });
}

/* ============================================================
   FINALIZE — show preview, save to localStorage, show feedback.

   heavilyCompressed: true when the cascade had to drop quality below
   the comfort threshold. We add a short hint about plain backgrounds
   so the user knows what to upload if the result looks too soft.
   ============================================================ */
function finalizePhoto(dataUrl, originalSize, finalSize, width, height, wasCompressed, heavilyCompressed) {
  photoPreview.src = dataUrl;
  photoPreview.classList.remove("hidden");
  photoPlaceholder.classList.add("hidden");
  photoDropzone.classList.add("has-image");

  /* Reveal the "Change photo" link below the circle. Always
     visible from this moment on so users immediately see they
     can replace the photo. */
  if (photoChangeLink) photoChangeLink.classList.remove("hidden");

  /* Save to localStorage (the Save & Continue handler later turns
     this into a Blob and uploads it to Supabase Storage). Also save
     the original + final sizes so we can show the optimization
     summary on page reload too. */
  localStorage.setItem("profile_photo", dataUrl);
  try {
    localStorage.setItem("profile_photo_original_size", String(originalSize));
    localStorage.setItem("profile_photo_final_size", String(finalSize));
  } catch (e) { /* localStorage quota — non-fatal */ }

  /* Update the size info chip directly above the Change Photo button.
     Shows the before→after compression in clear language. */
  updatePhotoSizeInfo(originalSize, finalSize, wasCompressed);

  /* Friendly feedback — let the user know what happened. */
  let msg;
  if (wasCompressed) {
    msg = "\u2713 Photo optimised: " + formatFileSize(originalSize) +
          " \u2192 " + formatFileSize(finalSize) +
          " (" + width + " \u00d7 " + height + " px).";
  } else {
    msg = "\u2713 Photo uploaded successfully (" + formatFileSize(finalSize) + ").";
  }

  /* If the cascade had to drop quality strongly, append a hint so
     the user knows what to upload for a sharper result. The upload
     itself is fine — this is informational, not an error. */
  if (heavilyCompressed) {
    msg += "  If it looks blurry, try a photo with a plain background — face clearly visible, " +
           "single-colour wall behind you, even lighting. Photos with busy backgrounds " +
           "(patterns, crowds, foliage) need stronger compression to fit our size limit.";
  }

  showSuccess(photoSuccess, msg);
}

/* ── Update the size info chip above "Change Photo".
   Shows a single clear message: "Photo Optimized to: X KB".
   Original size is intentionally NOT shown (founder requirement —
   only the result matters to the user, not the math). */
function updatePhotoSizeInfo(originalSize, finalSize, wasCompressed) {
  const el = document.getElementById("photoSizeInfo");
  if (!el) return;
  if (!finalSize) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.innerHTML =
    '<span class="photo-size-info__icon" aria-hidden="true">\u2713</span>' +
    '<span class="photo-size-info__body">' +
      '<span class="photo-size-info__label">Photo Optimized to:</span> ' +
      '<span class="photo-size-info__to">' + formatFileSize(finalSize) + '</span>' +
    '</span>';
  el.classList.remove("hidden");
}

/* ============================================================
   CV LINKS — per-domain URL inputs (Phase 1 Step 3)

   Replaces the old CV file upload. Each "row" is one CV: a domain
   dropdown, an optional sub-domain text input, and a URL field that
   accepts a Google Drive / OneDrive / Dropbox link.

   Up to 6 rows. Validation, normalization, and double-confirmation
   popups all live below.
   ============================================================ */

/* In-memory state: array of { rowEl, domainSel, otherInput, subDomainInput,
   urlInput, feedbackEl }. Row uid is just the index in the array. */
const cvRows = [];

/* ── URL normalize + validate ──
   Takes user input, fixes common typos, validates against supported
   providers, and rejects folder URLs. Returns:
     { ok: true,  url, provider, providerLabel } on success
     { ok: false, reason: "...", hostname? }    on failure
*/
function normalizeAndValidateCvUrl(rawInput) {
  if (!rawInput) return { ok: false, reason: "empty" };
  let s = String(rawInput).trim();

  /* Strip wrapping single or double quotes (common when copy-pasting from chat
     apps that auto-quote URLs). */
  s = s.replace(/^["']+|["']+$/g, "");

  /* Strip trailing punctuation that often gets included in copy-paste
     (period, comma, semicolon, closing parens). */
  s = s.replace(/[.,;)\]]+$/g, "");

  /* Auto-fix common protocol typos. Order matters: longest-prefix first. */
  if (/^htps:\/\//i.test(s))  s = "https://" + s.slice(7);
  else if (/^htp:\/\//i.test(s))   s = "https://" + s.slice(6);
  else if (/^https\/\//i.test(s))  s = "https://" + s.slice(7);
  else if (/^http:\/\//i.test(s))  s = "https://" + s.slice(7);
  else if (!/^https:\/\//i.test(s)) s = "https://" + s;

  /* Try to parse. If it fails, the user pasted something that isn't a URL. */
  let parsed;
  try {
    parsed = new URL(s);
  } catch (e) {
    return { ok: false, reason: "malformed" };
  }

  /* Hostname check — must be one of the supported providers.
     Strip leading "www." for matching. */
  let hostname = (parsed.hostname || "").toLowerCase();
  if (hostname.startsWith("www.")) hostname = hostname.slice(4);

  const providerInfo = CV_PROVIDERS[hostname];
  if (!providerInfo) {
    return { ok: false, reason: "unsupported_provider", hostname: hostname };
  }

  /* Folder check — reject patterns that are clearly folders.
     Done on the URL pathname, case-insensitive. */
  const path = parsed.pathname || "/";
  for (const pat of CV_FOLDER_PATTERNS) {
    if (pat.test(path)) {
      return { ok: false, reason: "is_folder", hostname: hostname };
    }
  }

  /* Reconstruct cleaned URL — toString on URL object normalises further. */
  return {
    ok            : true,
    url           : parsed.toString(),
    provider      : providerInfo.provider,
    providerLabel : providerInfo.label
  };
}

/* ── User-facing message for a validation failure ── */
function cvUrlErrorMessage(result, hostnameFromInput) {
  if (!result || result.reason === "empty") {
    return "";  /* empty is allowed for an unfilled row — caller decides */
  }
  if (result.reason === "malformed") {
    return "This doesn't look like a valid web link. Make sure you copied the full URL from your browser's address bar.";
  }
  if (result.reason === "unsupported_provider") {
    return "We accept Google Drive, OneDrive, and Dropbox links only. Your link is from \"" +
           (result.hostname || hostnameFromInput || "an unsupported service") +
           "\". Please use one of the supported services.";
  }
  if (result.reason === "is_folder") {
    return "This link points to a folder, not a single document. Please copy the link of the CV file itself, not the folder it's in.";
  }
  return "This link could not be validated. Please check it.";
}

/* ── Render a single CV row.
   Each row has: domain <select>, optional "Other" text input,
   sub-domain text input (placeholder updates with domain), URL text input
   with inline ✓/✗ feedback on blur, "Open" button, "Remove" button.
   Returns the row's container element for caller to attach. ── */
function buildCvRow(rowIndex, prefill) {
  prefill = prefill || {};
  const wrap = document.createElement("div");
  wrap.className = "cv-link-row";
  wrap.setAttribute("data-row-index", String(rowIndex));

  /* Header: "CV #1" + Remove button (Remove hidden on the only-row case;
     re-shown when there's more than one row). */
  const header = document.createElement("div");
  header.className = "cv-link-row__header";
  const titleEl = document.createElement("span");
  titleEl.className = "cv-link-row__title";
  titleEl.textContent = "CV #" + (rowIndex + 1);
  header.appendChild(titleEl);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "cv-link-row__remove";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => removeCvRow(wrap));
  header.appendChild(removeBtn);
  wrap.appendChild(header);

  /* Domain dropdown */
  const domainGroup = document.createElement("div");
  domainGroup.className = "field-group";
  const domainLabel = document.createElement("label");
  domainLabel.className = "field-label";
  domainLabel.innerHTML = 'Domain of this CV<span class="cv-required-mark" aria-label="required">*</span>';
  domainGroup.appendChild(domainLabel);
  const domainHint = document.createElement("p");
  domainHint.className = "field-sublabel";
  domainHint.textContent = "Pick the area of expertise this CV represents.";
  domainGroup.appendChild(domainHint);
  const domainSel = document.createElement("select");
  domainSel.className = "field-select";
  /* Empty default option */
  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "— Select your domain —";
  domainSel.appendChild(emptyOpt);
  CV_DOMAINS.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    domainSel.appendChild(opt);
  });
  if (prefill.domain) domainSel.value = prefill.domain;
  domainGroup.appendChild(domainSel);
  wrap.appendChild(domainGroup);

  /* "Other (please specify)" — appears only when domain = Other */
  const otherGroup = document.createElement("div");
  otherGroup.className = "field-group hidden";
  const otherLabel = document.createElement("label");
  otherLabel.className = "field-label";
  otherLabel.innerHTML = 'Please specify your domain<span class="cv-required-mark" aria-label="required">*</span>';
  otherGroup.appendChild(otherLabel);
  const otherInput = document.createElement("input");
  otherInput.type = "text";
  otherInput.className = "field-input";
  otherInput.maxLength = 60;
  otherInput.placeholder = "e.g. Public Policy, Astrobiology";
  if (prefill.domain_other) otherInput.value = prefill.domain_other;
  otherGroup.appendChild(otherInput);
  wrap.appendChild(otherGroup);

  /* Sub-domain — MANDATORY (founder requirement: every domain has sub-domains) */
  const subGroup = document.createElement("div");
  subGroup.className = "field-group";
  const subLabel = document.createElement("label");
  subLabel.className = "field-label";
  subLabel.innerHTML = 'Sub-domain<span class="cv-required-mark" aria-label="required">*</span>';
  subGroup.appendChild(subLabel);
  const subHint = document.createElement("p");
  subHint.className = "field-sublabel";
  subHint.innerHTML = 'Required. Narrow your specialization within the chosen domain. Examples: <strong>Talent Acquisition</strong> for HR, <strong>Civil Law</strong> for Legal, <strong>Healthcare Analytics</strong> for Data Analytics.';
  subGroup.appendChild(subHint);
  const subInput = document.createElement("input");
  subInput.type = "text";
  subInput.className = "field-input";
  subInput.maxLength = 80;
  subInput.placeholder = "Pick a domain above to see suggestions";
  if (prefill.sub_domain) subInput.value = prefill.sub_domain;
  subGroup.appendChild(subInput);
  wrap.appendChild(subGroup);

  /* CV link */
  const urlGroup = document.createElement("div");
  urlGroup.className = "field-group";
  const urlLabel = document.createElement("label");
  urlLabel.className = "field-label";
  urlLabel.innerHTML = 'CV Link<span class="cv-required-mark" aria-label="required">*</span>';
  urlGroup.appendChild(urlLabel);
  const urlHint = document.createElement("p");
  urlHint.className = "field-sublabel field-sublabel--strong";
  urlHint.innerHTML = 'Paste a link from <strong>Google Drive</strong>, <strong>OneDrive</strong>, or <strong>Dropbox</strong> only. Other services will be <strong>rejected</strong>. You can paste with or without <code>https://</code> &mdash; we&rsquo;ll add it automatically.';
  urlGroup.appendChild(urlHint);
  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.className = "field-input field-input--url";
  urlInput.placeholder = "Paste your CV link here, e.g. https://drive.google.com/file/d/…";
  urlInput.autocomplete = "off";
  urlInput.spellcheck = false;
  if (prefill.url) urlInput.value = prefill.url;
  urlGroup.appendChild(urlInput);

  /* Inline feedback area (shows after blur once user has typed) */
  const feedback = document.createElement("div");
  feedback.className = "cv-link-row__feedback";
  urlGroup.appendChild(feedback);

  /* Action button row: "Open link in new tab" — for the user to verify */
  const actionRow = document.createElement("div");
  actionRow.className = "cv-link-row__actions";
  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.className = "btn btn--ghost btn--small";
  openBtn.textContent = "Open link in new tab to verify";
  openBtn.addEventListener("click", () => {
    const v = (urlInput.value || "").trim();
    if (!v) {
      showPopup("Paste a CV link first, then click this button to open it in a new tab.");
      return;
    }
    const norm = normalizeAndValidateCvUrl(v);
    if (!norm.ok) {
      showPopup(cvUrlErrorMessage(norm));
      return;
    }
    /* Update the input to the normalised URL so the user sees what we store */
    urlInput.value = norm.url;
    refreshFeedback();
    window.open(norm.url, "_blank", "noopener,noreferrer");
  });
  actionRow.appendChild(openBtn);
  urlGroup.appendChild(actionRow);

  wrap.appendChild(urlGroup);

  /* Wiring */
  function refreshSubdomainPlaceholder() {
    const d = domainSel.value;
    const ph = CV_SUBDOMAIN_PLACEHOLDERS[d];
    subInput.placeholder = ph || "Pick a domain above to see suggestions";
  }
  function refreshOtherVisibility() {
    const isOther = domainSel.value === "Other (please specify)";
    otherGroup.classList.toggle("hidden", !isOther);
  }
  function refreshFeedback() {
    const v = (urlInput.value || "").trim();
    feedback.textContent = "";
    feedback.className = "cv-link-row__feedback";
    if (!v) return;  /* no feedback for empty */
    const norm = normalizeAndValidateCvUrl(v);
    if (norm.ok) {
      feedback.textContent = "\u2713 " + norm.providerLabel + " link accepted";
      feedback.classList.add("cv-link-row__feedback--ok");
      /* Update the field to the cleaned URL so user sees what we'll save */
      urlInput.value = norm.url;
    } else {
      feedback.textContent = "\u2717 " + cvUrlErrorMessage(norm);
      feedback.classList.add("cv-link-row__feedback--err");
    }
  }
  domainSel.addEventListener("change", () => {
    refreshSubdomainPlaceholder();
    refreshOtherVisibility();
  });
  urlInput.addEventListener("blur", refreshFeedback);
  /* Initial sync (if prefilled) */
  refreshSubdomainPlaceholder();
  refreshOtherVisibility();
  if (prefill.url) refreshFeedback();

  return {
    rowEl   : wrap,
    domainSel,
    otherInput,
    subDomainInput: subInput,
    urlInput,
    feedbackEl: feedback,
    removeBtn
  };
}

/* ── Add a new row to the container.
   prefill is optional — used when restoring saved data. ── */
function addCvRow(prefill) {
  if (cvRows.length >= CV_LINKS_MAX) {
    showPopup("You've reached the maximum of " + CV_LINKS_MAX + " CV links.");
    return null;
  }
  const idx = cvRows.length;
  const row = buildCvRow(idx, prefill);
  cvRowsContainer.appendChild(row.rowEl);
  cvRows.push(row);
  refreshAddBtnState();
  refreshRemoveBtnVisibility();
  return row;
}

/* ── Remove a row by element reference, re-index, refresh visibility ── */
function removeCvRow(rowEl) {
  const idx = cvRows.findIndex(r => r.rowEl === rowEl);
  if (idx < 0) return;
  cvRows.splice(idx, 1);
  rowEl.remove();
  /* Re-number visible CV titles so they stay consecutive */
  cvRows.forEach((r, i) => {
    const titleEl = r.rowEl.querySelector(".cv-link-row__title");
    if (titleEl) titleEl.textContent = "CV #" + (i + 1);
    r.rowEl.setAttribute("data-row-index", String(i));
  });
  refreshAddBtnState();
  refreshRemoveBtnVisibility();
}

/* ── Disable Add button when at max; refresh hint text ── */
function refreshAddBtnState() {
  if (!addCvDomainBtn) return;
  const atMax = cvRows.length >= CV_LINKS_MAX;
  addCvDomainBtn.disabled = atMax;
  addCvDomainBtn.classList.toggle("disabled", atMax);
  if (cvCountHint) {
    cvCountHint.textContent = atMax
      ? "You've added the maximum of " + CV_LINKS_MAX + " CVs."
      : "You can add up to " + CV_LINKS_MAX + " CVs. Currently added: " + cvRows.length + ".";
  }
}

/* ── When there's only one row, hide its Remove button (the user shouldn't
     be able to delete their only CV — they'd have an unfillable form) ── */
function refreshRemoveBtnVisibility() {
  const onlyOne = cvRows.length === 1;
  cvRows.forEach(r => {
    if (r.removeBtn) r.removeBtn.classList.toggle("hidden", onlyOne);
  });
}

/* ── Wire Add button + add Row 1 on init ── */
if (addCvDomainBtn) {
  addCvDomainBtn.addEventListener("click", () => addCvRow());
}

/* ── Read the current rows into a clean array suitable for saving.
   Returns { rows: [...], errors: [...] }. errors is per-row friendly
   text. rows includes all VALID rows — empty rows are skipped, partial
   rows generate errors. ── */
function collectCvLinks() {
  const out = [];
  const errors = [];
  const seenKeys = new Set();   /* domain + sub_domain pair, lowercase */

  cvRows.forEach((r, i) => {
    const num = i + 1;
    const domain    = (r.domainSel.value || "").trim();
    const isOther   = domain === "Other (please specify)";
    const otherTxt  = (r.otherInput.value || "").trim();
    const subDomain = (r.subDomainInput.value || "").trim();
    const rawUrl    = (r.urlInput.value || "").trim();

    /* All-empty row is silently skipped — user just didn't fill it. */
    if (!domain && !otherTxt && !subDomain && !rawUrl) return;

    /* Partial row */
    if (!domain) {
      errors.push("CV #" + num + ": please choose a domain.");
      return;
    }
    if (isOther && !otherTxt) {
      errors.push("CV #" + num + ": please specify your domain in the Other field.");
      return;
    }
    /* Sub-domain mandatory (founder requirement: every domain has a
       sub-domain — HR has Talent Acquisition / L&D / Comp & Benefits
       etc., Legal has Civil / Criminal / Property etc.). */
    if (!subDomain) {
      errors.push("CV #" + num + ": please enter a sub-domain. " +
                  "Examples: \"Talent Acquisition\" for HR, \"Civil Law\" for Legal, " +
                  "\"Healthcare Analytics\" for Data Analytics.");
      return;
    }
    if (!rawUrl) {
      errors.push("CV #" + num + ": please paste your CV link.");
      return;
    }

    /* URL validation */
    const norm = normalizeAndValidateCvUrl(rawUrl);
    if (!norm.ok) {
      errors.push("CV #" + num + ": " + cvUrlErrorMessage(norm));
      return;
    }

    /* Duplicate (domain + sub_domain) check.
       A user might legitimately have multiple "Data Analytics" CVs with
       different sub-domains — that's fine. But two with the SAME pair is
       a mistake. Comparison is case-insensitive on both halves.
       Now that sub-domain is mandatory, we always include it in the key. */
    const effectiveDomain = isOther ? otherTxt : domain;
    const dupKey = (effectiveDomain + "::" + subDomain).toLowerCase();
    if (seenKeys.has(dupKey)) {
      errors.push("CV #" + num + ": this domain + sub-domain combination is " +
                  "already used in another CV. Each CV must be a different specialization.");
      return;
    }
    seenKeys.add(dupKey);

    out.push({
      domain        : domain,
      domain_other  : isOther ? otherTxt : null,
      sub_domain    : subDomain,
      url           : norm.url,
      provider      : norm.provider
    });
  });

  return { rows: out, errors: errors };
}

/* ── Show a Yes/Cancel confirmation popup. Returns a Promise that
     resolves true on Yes, false on Cancel. Reuses the same DOM as the
     existing single-button popup but reveals the secondary Cancel
     button while open. ── */
function showConfirm(message, yesLabel) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("errorPopupOverlay");
    const msgEl   = document.getElementById("errorPopupMessage");
    const okBtn   = document.getElementById("errorPopupClose");
    const noBtn   = document.getElementById("errorPopupCancel");
    if (!overlay || !msgEl || !okBtn || !noBtn) {
      /* Fallback if popup chrome isn't present */
      const ok = window.confirm(message);
      resolve(!!ok);
      return;
    }
    msgEl.innerText = message;
    okBtn.textContent = yesLabel || "Yes";
    noBtn.classList.remove("hidden");
    overlay.classList.add("show");

    function cleanup(result) {
      overlay.classList.remove("show");
      noBtn.classList.add("hidden");
      okBtn.textContent = "OK";
      okBtn.removeEventListener("click", onYes);
      noBtn.removeEventListener("click", onNo);
      resolve(result);
    }
    function onYes() { cleanup(true); }
    function onNo()  { cleanup(false); }
    okBtn.addEventListener("click", onYes);
    noBtn.addEventListener("click", onNo);
  });
}

/* ============================================================
   SAVE & COME BACK LATER
   ============================================================ */

const saveLaterBtn = document.getElementById("saveLaterBtn");

if (saveLaterBtn) {
  saveLaterBtn.addEventListener("click", () => {
    /* Save what's been added so far. Photo lives in localStorage when uploaded;
       CV links live in cvRows (in-memory). The user just needs to have either. */
    const photoSaved = localStorage.getItem("profile_photo");
    const { rows: linksProvided } = collectCvLinks();

    if (!photoSaved && linksProvided.length === 0) {
      showPopup("You haven't added anything yet. Upload your photo or add at least one CV link before saving.");
      return;
    }

    localStorage.setItem(
      "profile_last_updated",
      new Date().toLocaleDateString("en-US")
    );
    /* Mark partial — not complete, but saves the photo if uploaded */
    localStorage.setItem("photo_cv_partial", "yes");

    /* Show confirmation inline */
    let banner = document.getElementById("saveLaterBanner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "saveLaterBanner";
      banner.className = "save-later-banner";
      document.querySelector(".form-container").prepend(banner);
    }
    banner.innerHTML =
      `<span class="save-later-banner__icon">✓</span>
       <span>Your progress has been saved. You can return and complete this section anytime from your dashboard.</span>`;
    banner.classList.remove("hidden");
    setTimeout(() => banner.classList.add("hidden"), 6000);
  });
}

/* ============================================================
   SAVE & CONTINUE
   ============================================================ */

saveBtn.addEventListener("click", async () => {
  /* Hide any previous CV-links error from a prior click */
  if (cvLinksError) {
    cvLinksError.textContent = "";
    cvLinksError.classList.add("hidden");
  }

  const photoSaved = localStorage.getItem("profile_photo");

  if (!photoSaved) {
    showPopup("Please upload your photograph before continuing.");
    return;
  }

  /* Validate CV-link rows. collectCvLinks() returns:
       { rows: [valid entries], errors: [strings per problematic row] } */
  const { rows: cvLinks, errors: cvErrors } = collectCvLinks();

  if (cvErrors.length > 0) {
    /* Show all errors at once so user can fix them in one pass.
       Anchored on the inline error block right under the rows. */
    if (cvLinksError) {
      cvLinksError.textContent = cvErrors.join("\n\n");
      cvLinksError.classList.remove("hidden");
    } else {
      showPopup(cvErrors.join("\n\n"));
    }
    return;
  }

  if (cvLinks.length === 0) {
    showPopup("Please add at least one CV link before continuing. " +
              "Choose your domain and paste your CV's Google Drive, OneDrive, or Dropbox link.");
    return;
  }

  /* ── Double confirmation popups ──
     Best-effort protection given we can't actually fetch the URLs to
     verify (CORS + Drive bot blocking). The user attests:
       1. Sharing is set to "anyone with the link"
       2. They tested in incognito

     IMPORTANT: MC.showConfirm uses a CALLBACK API — it does not return
     a Promise. We promise-wrap it here so the save flow can `await`
     each confirmation cleanly. Without this wrapper, `await showConfirm(...)`
     resolves to undefined immediately and the subsequent `if (!ok)` check
     bails the function — meaning Save & Continue silently does nothing. */
  function confirmAsync(message, confirmLabel) {
    return new Promise(resolve => {
      MC.showConfirm(
        message,
        () => resolve(true),               // user clicked confirm
        {
          confirmLabel: confirmLabel,
          cancelLabel : "Cancel"
        }
      );
      /* If user clicks Cancel, MC.showConfirm closes the popup but
         doesn't call any callback. We listen for the cancel button
         too so the promise resolves false instead of hanging. */
      const cancelBtn = document.getElementById("errorPopupCancel");
      if (cancelBtn) {
        const onCancel = () => {
          cancelBtn.removeEventListener("click", onCancel);
          resolve(false);
        };
        cancelBtn.addEventListener("click", onCancel);
      }
    });
  }

  const ok1 = await confirmAsync(
    "Are ALL your CV links set to \"Anyone with the link can view\" (not private)?\n\n" +
    "Click Yes only if you have already changed the sharing setting on Google Drive, OneDrive, or Dropbox for each CV.",
    "Yes, all are public"
  );
  if (!ok1) return;

  const ok2 = await confirmAsync(
    "Have you opened EACH link in a private / incognito browser tab and confirmed the CV opens for someone who isn't logged in as you?\n\n" +
    "If a link works for you but not in incognito, the sharing is still private. " +
    "Please test each link before continuing.",
    "Yes, I have tested each link"
  );
  if (!ok2) return;

  setLoading(saveBtn, true);

  /* ── Helper: convert a base64 data URL to a Blob ──
     Used for the photo. Photo storage upload still required. */
  function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(",");
    if (parts.length !== 2) throw new Error("Invalid data URL");
    const meta  = parts[0];
    const b64   = parts[1];
    const mimeMatch = meta.match(/data:([^;]+);base64/);
    const mime  = mimeMatch ? mimeMatch[1] : "application/octet-stream";
    const bin   = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  /* ── Upload photo to Storage; save photo_path to profiles row;
       save cv_links array to profiles.data.cv_links JSONB. ── */
  try {
    const sb          = MC_SB.getClient();
    const candidateId = await MC_SB.getCandidateId();

    /* Photo upload */
    const photoBlob = dataUrlToBlob(photoSaved);
    const photoExt  = (photoBlob.type === "image/png")  ? "png"
                    : (photoBlob.type === "image/webp") ? "webp"
                    : "jpg";
    const photoPath = `${candidateId}/photo.${photoExt}`;
    {
      const { error } = await sb.storage
        .from("photos")
        .upload(photoPath, photoBlob, { upsert: true, contentType: photoBlob.type });
      if (error) throw new Error("Photo upload: " + error.message);
    }

    /* Save photo_path direct column. The legacy cv_path / cv_uploaded_at /
       upload_meta fields are intentionally NOT written here — they belonged
       to the old file-upload model and are now unused. We don't clear them
       either (leaving stale values for users who already had them is harmless;
       the public profile and admin pages will read cv_links instead). */
    await MC.saveProfileFields({
      photo_path : photoPath
    });

    /* Save the CV links array to profiles.data.cv_links JSONB section.
       Each entry: { domain, domain_other, sub_domain, url, provider }.
       Storage cost: ~150 bytes per CV × 6 CVs = ~1 KB per user. Trivial. */
    await MC.saveSection("cv_links", cvLinks);

  } catch (err) {
    console.error("[photo_cv] save failed:", err);
    showPopup("Could not save to server. Please try again.\n\n" + (err.message || err));
    setLoading(saveBtn, false);
    return;
  }

  /* Persist completion markers (localStorage stays as fast cache) */
  localStorage.setItem("photo_cv_completed", "yes");
  localStorage.setItem(
    "profile_last_updated",
    new Date().toLocaleDateString("en-US")
  );

  /* Tell parent dashboard to navigate to Profile Category */
  window.parent.postMessage(
    {
      type      : "navigate",
      page      : "profile_category.html",
      sidebarKey: "Your Profile Category"
    },
    "*"
  );

  setTimeout(() => setLoading(saveBtn, false), 800);
});

/* ============================================================
   RESTORE ON LOAD
   When the user navigates back to this page (or refreshes), show
   any photo or CV they had previously uploaded so they can see
   their progress instead of an empty dropzone.
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  /* Restore photo preview from localStorage (fast cache) */
  try {
    const savedPhoto = localStorage.getItem("profile_photo");
    if (savedPhoto && photoPreview) {
      photoPreview.src = savedPhoto;
      photoPreview.classList.remove("hidden");
      if (photoPlaceholder) photoPlaceholder.classList.add("hidden");
      if (photoDropzone) photoDropzone.classList.add("has-image");
      /* Show the "Change photo" link since there's already a photo */
      if (photoChangeLink) photoChangeLink.classList.remove("hidden");
      /* Restore the photo size info chip if we have saved sizes */
      try {
        const savedOrig  = parseInt(localStorage.getItem("profile_photo_original_size"), 10);
        const savedFinal = parseInt(localStorage.getItem("profile_photo_final_size"),    10);
        if (!isNaN(savedFinal) && savedFinal > 0) {
          const wasCompressed = !isNaN(savedOrig) && savedOrig > savedFinal;
          updatePhotoSizeInfo(
            isNaN(savedOrig) ? null : savedOrig,
            savedFinal,
            wasCompressed
          );
        }
      } catch (e) { /* non-fatal */ }
    }
  } catch (err) {
    /* localStorage may throw in private mode — non-fatal */
    console.warn("Could not restore photo:", err);
  }

  /* ── Restore CV links from saved data (if any) and ensure at least
     one empty row is visible so the user always has a place to start. ── */
  let savedLinks = null;
  try {
    savedLinks = await MC.loadSection("cv_links");
  } catch (err) {
    console.warn("[photo_cv] loadSection cv_links failed:", err);
  }

  if (Array.isArray(savedLinks) && savedLinks.length > 0) {
    /* Each entry can have keys: domain, domain_other, sub_domain, url, provider.
       Provider is recomputed from the URL on save, so we don't need to read it. */
    savedLinks.slice(0, CV_LINKS_MAX).forEach(item => {
      addCvRow({
        domain      : item.domain       || "",
        domain_other: item.domain_other || "",
        sub_domain  : item.sub_domain   || "",
        url         : item.url          || ""
      });
    });
  } else {
    /* No saved CVs — start with one empty row. */
    addCvRow();
  }

  /* ── Fall back to Supabase Storage for photo if localStorage is empty
     (different browser, cleared cache, etc.). The legacy upload_meta and
     cv_path columns are intentionally NOT read here — old users may have
     them but we now consider them unused. ── */
  try {
    if (!localStorage.getItem("profile_photo")) {
      const sb = MC_SB.getClient();
      let row = {};
      try {
        row = await MC.loadProfileFields(["photo_path"]);
      } catch (e) {
        console.warn("[photo_cv] loadProfileFields failed:", e);
      }
      if (row && row.photo_path && photoPreview) {
        const { data: blob, error: dlErr } = await sb.storage
          .from("photos")
          .download(row.photo_path);
        if (!dlErr && blob) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            photoPreview.src = ev.target.result;
            photoPreview.classList.remove("hidden");
            if (photoPlaceholder) photoPlaceholder.classList.add("hidden");
            if (photoDropzone) photoDropzone.classList.add("has-image");
            if (photoChangeLink) photoChangeLink.classList.remove("hidden");
            try {
              localStorage.setItem("profile_photo", ev.target.result);
              localStorage.setItem("profile_photo_final_size", String(blob.size));
            } catch (e) {}
            /* We don't have original size here (Storage doesn't track it).
               Show just the final size with an "(optimized)" suffix. */
            updatePhotoSizeInfo(null, blob.size, false);
          };
          reader.readAsDataURL(blob);
        }
      }
    }
  } catch (err) {
    console.warn("[photo_cv] Supabase restore fallback error:", err);
  }
});
