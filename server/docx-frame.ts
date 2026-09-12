// Dedicated response: srcdoc would inherit the app's stricter style policy.
// Document CSS is isolated here, with scripts, remote assets, and navigation disabled.
export const DOCX_FRAME_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-same-origin"

export const DOCX_FRAME_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Word preview</title><style>
html, body { margin: 0; min-height: 100%; background: #d7dbd8; }
/* Fixed-layout Word pages already scale as a whole. Mobile text inflation
   would enlarge glyphs independently of their line boxes and overlap rows.
   This is iframe-local; browser pinch zoom and the viewer controls stay usable. */
html { -webkit-text-size-adjust: none; text-size-adjust: none; }
body { overflow: auto; overscroll-behavior: contain; }
#document { width: max-content; min-width: 100%; }
.docx-wrapper { padding: 12px !important; background: transparent !important; }
.docx-wrapper > section.docx { margin-bottom: 12px; flex-shrink: 0; }
</style></head><body><div id="document" aria-label="Word document"></div></body></html>`
