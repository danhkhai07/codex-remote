/** Static, public, non-private renderer. Opaque sandbox; never receives any key. */
export const SECURE_VIEWER_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts"
export const SECURE_VIEWER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Secure document</title></head><body><script>
addEventListener('message',function receive(event){
 if(event.source!==parent||event.data?.type!=='codex-secure-html'||typeof event.data.html!=='string')return;
 removeEventListener('message',receive);
 document.open();document.write(event.data.html);document.close();
});
</script></body></html>`
