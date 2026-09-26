# Readable Markdown table widths — correction candidate

Task `fbe2bf8d-38aa-4b2d-b049-e0103d7f7d8e` corrects the table layout now
LIVE from product source `4ee45dbd559c9c975a0c26fb1fb2d2af3d3920a0`. The
working branch starts at report commit
`3c0e5ae746c7fb838bd9048bc0ec7d02e40a7189`. This correction is verified but
has not been deployed.

## Behavior

Chat and Files continue to share the semantic Markdown table wrapper. Compact
tables use the available width and wrap ordinary prose at word boundaries. A
table containing a cell with at least 48 characters uses content-sized columns
inside the existing local overflow container. Those columns can wrap up to an
18rem readable width; the table scrolls horizontally when the viewport cannot
hold that layout. Links and inline code can still break inside their cells, and
all content remains present.

The 48-character trigger and 18rem cell width are presentation thresholds, not
data limits. They replace the prior column-count rule: a long two-, three- or
four-column table can now scroll, while a short four-column scalar table still
fits at 320px. A short two-column ingredient table wraps normally without a
scrollbar. No font size is reduced.

## Reproduction and acceptance

The encrypted Chromium fixture uses the actual chat and Files Markdown
renderers with the reported four-column donut schema and long Vietnamese cells.
It also covers short two/three/four-column tables, an 80+ word row, a long URL,
a 64-character inline-code hash, six columns and a code block outside the
table. It runs at 1280, 768, 390, 375 and 320px without document-level overflow
or a model turn.

At 375px in chat, the prior layout gave each prose column 82.75px, split
`Chocolate` over two lines and made the first row 949.83px high. The correction
uses a 288px prose column, keeps `Chocolate` on one line and reduces the row to
191.86px. Files changes from 82.25px and 749.86px to 288px and 158.84px. At
320px, the chat row falls from 1151.95px to 191.86px. The same acceptance holds
at 390px. The long table scrolls only inside its wrapper; compact scalar tables
fit at all five widths.

One sequential `codex-heavy` final job passed lint with zero findings,
TypeScript, client build, PWA validation and the focused encrypted browser
fixture. The final log SHA256 is
`f7a26347538f4418d7de6869d51f84b1d98e14e899b5cff9566aef15e0fbacf8`.
Baseline and acceptance screenshots and measurements are under
`/root/.local/state/codex-remote-secure/reviews/markdown-table-correction-fbe2bf8d`.
The 375px chat donut screenshots have SHA256
`3136f148a280893afa35d6b990d29cd540ee17b7ec9e0380549ea138f1c79a3d`
before and
`4b1e391600df651726a711ee0bba458d661fb94b6b87dd7a03fb3aefa7ef9cc8`
after.

The matching client artifact has 25 files at `client-final`; its sorted SHA256
list has SHA256
`004875aa89c2cb9c751f9b74194a1cb5d6a8d3a3af750938226310676a899b4b`.
The main CSS artifact is
`assets/index-aPLw5wi3.css` with SHA256
`8fd5e67189ce92d699eca3cc0d26cecbd7142aad160efe01cee59f487899c9ad`.

## Integration boundary

Product changes are limited to `src/MarkdownTable.tsx` and the shared table
rules in `src/styles.css`; `scripts/markdown-table-browser.mjs` is fixture-only.
The backend, dependencies, Hours, key, runtime state, transcript and all other
client behavior are unchanged. Publish the whole matching client graph under
the existing frontend lock with assets first and `index.html` last. This delta
does not require a backend restart. Physical Safari/iOS remains untested.
