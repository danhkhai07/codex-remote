# Markdown table wrapping — candidate

Task `5c6a6b84-339e-4279-9191-4b688a58a181` starts from exact source
`d6990d30b98ec4100e26752213017a90c0559853`. It is a client-only candidate;
it has not been deployed or armed.

## Behavior

Chat Markdown and the Files Markdown preview now use the same semantic table
component with a local overflow container. Tables with up to four columns use
the available width and wrap cell content. Links, Vietnamese prose, hashes and
inline code remain complete. Tables with five or more columns keep a 46rem
minimum intrinsic table width, so narrow layouts scroll the table locally
instead of crushing columns or overflowing the document. A sufficiently wide
desktop still renders those tables without a scrollbar. Code blocks outside
tables retain their separate overflow behavior.

The five-column boundary and 46rem minimum are implementation choices for this
layout, not user data limits. The wrapper preserves the native `table`, `thead`,
`tbody`, row and cell semantics.

## Verification

One final sequential `codex-heavy` job passed lint with zero findings,
TypeScript, client build, PWA validation and the focused encrypted Chromium
fixture. The fixture exercises the real chat and Files Markdown renderers at
1280, 768, 390 and 320px with short, four-column Vietnamese prose, long URL,
64-character inline-code hash, six-column and external code-block cases.

At every width the first three tables fit without local horizontal overflow,
cell text remains present and the document does not overflow. The six-column
table fits at 1280 and scrolls locally at 768/390/320. Both renderers have the
same result. The fixture sends no model turn and writes only disposable files,
native history and key material. Chromium viewport checks do not prove physical
iOS/Safari behavior.

Evidence is under
`/root/.local/state/codex-remote-secure/reviews/markdown-table-5c6a6b84`:

- `final-pass.log` SHA256 `6e38d834009226cda57aeddadf078f246898462a0cd981fa1e557c93d7a4d330`;
- eight chat/Files screenshots for the four widths;
- matching 25-file client inventory SHA256
  `1c889a67b409ab142c145b0a65e3bc288520e6a9f95a924c21d41f97d3840ff7`.

## Integration boundary

Product source changes are limited to `src/MarkdownTable.tsx`, the chat and
Files renderer registrations in `src/MarkdownMessage.tsx` and
`src/FileViewer.tsx`, and the Markdown table rules in `src/styles.css`.
`scripts/markdown-table-browser.mjs` is fixture-only. Backend, protocol,
dependencies, Hours, key, state and existing history/tool behavior are
unchanged.

Publish a whole matching client graph rather than mixing hashed entry assets.
Root should integrate this commit on the accepted history source, rebuild, then
use the existing client publication lock with assets before `index.html` and
normal PWA verification. No backend restart is required by this delta itself.
