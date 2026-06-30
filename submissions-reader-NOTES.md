# Read-the-Script — concept notes

Mock: **`submissions-reader-mock.html`** (open it over a local server, not `file://`,
so the sample PDF + fonts load):

```
cd interdependent-web/site && python3 -m http.server 8731
# → http://localhost:8731/submissions-reader-mock.html
```

Click **The Midnight Line**, then try the four ways to read. Sample screenplay is
`sample-script.pdf` (regenerate with `python3 _make_sample_script.py`).

---

## What's already true in production (no schema change needed)

Every submitted PDF is **already stored** — Supabase Storage, private `scripts`
bucket, key in `scripts.storage_path` (`{userId}/{scriptId}/{filename}`). The
retry route already downloads it. So "read the script" needs **no new storage and
no re-upload** — only a way to hand the reader a URL to the existing file.

The extracted plain text is *not* persisted (only page/word/char counts). That's
fine: a screenplay's formatting (Courier, scene headings, dialogue blocks) is the
point, and the **original PDF preserves it perfectly**. Read the PDF, not a reflow.

## Recommendation

1. **Primary — a dedicated full-screen Reader** (the "Open reader" button): the
   screenplay on the left, the coverage (decision, weighted score, the six score
   bars + justifications, comps, summary) docked on the right, collapsible to read
   full-width. This is the best of the three options you floated — you read the
   script *and* keep Casey's read next to it, without leaving the app.
2. **Keep Download + Open-in-new-tab** as one-click fallbacks (they're trivial and
   some people just want the file).
3. **Quick preview** (PDF inline in the existing detail modal) is a nice-to-have —
   good for a glance, cramped for a full read. Ship it if cheap, skip if not.

## Render with PDF.js, not a native `<embed>`/`<iframe>`

The mock renders the PDF to `<canvas>` via PDF.js. Do the same in production.
Native PDF embedding looks simpler but **fails on mobile Safari/Chrome** (they
force a download instead of rendering inline) and is inconsistent in-frame on
desktop. PDF.js renders identically everywhere and lets us theme the page frame
on-brand. Load it from a CDN or vendor `pdf.min.js` + `pdf.worker.min.js`.

---

## The one backend addition — a signed-URL endpoint

The bucket is private, so the browser can't hit the file directly. Add a route
that returns a short-lived signed URL (the service-role key stays server-side).

**`interdependent-api/src/services/supabaseService.js`**

```js
export async function createSignedPdfUrl(storagePath, expiresIn = 600, downloadName) {
  const { data, error } = await supabase.storage
    .from('scripts')
    .createSignedUrl(storagePath, expiresIn, downloadName ? { download: downloadName } : undefined);
  if (error) throw new Error(`Storage signedUrl: ${error.message}`);
  return data.signedUrl;
}
```

**`interdependent-api/src/routes/scripts.js`** (already `requireAuth`-gated)

```js
import { getScriptById, createSignedPdfUrl } from '../services/supabaseService.js';

// GET /scripts/:id/pdf-url        → { url }   (inline reading)
// GET /scripts/:id/pdf-url?dl=1   → { url }   (forces download w/ a clean filename)
router.get('/:id/pdf-url', async (req, res, next) => {
  try {
    const row = await getScriptById(req.params.id);
    if (!row) return next(new AppError('Script not found', 404));
    if (!row.storage_path) return next(new AppError('No stored PDF for this submission', 404));
    const dl  = req.query.dl === '1' ? `${row.title.replace(/[^\w]+/g, '_')}.pdf` : undefined;
    const url = await createSignedPdfUrl(row.storage_path, 600, dl);
    res.json({ url });
  } catch (err) {
    next(err instanceof AppError ? err : new AppError(err.message, 500));
  }
});
```

No CORS change needed — the signed URL is served by Supabase's own host, and the
`/pdf-url` call itself is a normal authenticated GET to the existing API origin.

## Front-end wiring (into the real `submissions.html`)

The detail modal already fetches `/scripts/:id`. Add the read actions there:

```js
async function signedPdfUrl(id, dl = false) {
  const t = getValidToken();
  const res = await apiFetch(`/scripts/${id}/pdf-url${dl ? '?dl=1' : ''}`,
                             { headers: { Authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error('Could not load the script file');
  return (await res.json()).url;
}
// Open reader:   const url = await signedPdfUrl(id);  pdfjsLib.getDocument(url) → canvas
// Download:      location.href = await signedPdfUrl(id, true);
// New tab:       window.open(await signedPdfUrl(id), '_blank');
```

Then lift the `renderPdfInto()` / reader / coverage-rail markup from the mock.

## Access note

`/submissions` is passcode-gated for the whole team. If down the line a writer
should read *only their own* script (not everyone's), gate `/scripts/:id/pdf-url`
on the submitter's email from the JWT. For the current internal-curation use, the
shared passcode is fine.
