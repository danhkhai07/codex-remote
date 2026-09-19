/** Path-mode compatibility for ordinary HTML assets, module imports and browser requests. */
export function previewPath(port: number, value: string): string {
  const prefix = `/preview/${port}`
  if (value.startsWith(`${prefix}/`) || value === prefix || value.startsWith(`${prefix}?`)) return value
  if (value.startsWith('/') && !value.startsWith('//')) return prefix + value
  try {
    const url = new URL(value)
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && Number(url.port) === port) {
      return prefix + url.pathname + url.search + url.hash
    }
  } catch { /* Relative and external URLs remain unchanged. */ }
  return value
}

function rewriteModule(source: string, port: number): string {
  return source.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])([^"'\r\n]+)\2/g,
    (_all, start: string, quote: string, path: string) => `${start}${quote}${previewPath(port, path)}${quote}`)
}

function browserAdapter(port: number): string {
  // Runs before the app's scripts. App bytes stay on /preview/<port>; never route
  // assets by global cookies, which would mix concurrent previews from two ports.
  return `(() => {
    const prefix = '/preview/${port}';
    const rewrite = value => {
      if (typeof value !== 'string' && !(value instanceof URL)) return value;
      const text = String(value);
      if (text.startsWith(prefix + '/') || text === prefix) return text;
      let url;
      try { url = new URL(text, location.href); } catch { return value; }
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port === '${port}';
      if (!local && url.host !== location.host) return value;
      if (url.pathname.startsWith(prefix + '/')) return value;
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return value;
      const protocol = ['ws:', 'wss:'].includes(url.protocol) ? (location.protocol === 'https:' ? 'wss:' : 'ws:') : location.protocol;
      return protocol + '//' + location.host + prefix + url.pathname + url.search + url.hash;
    };
    const fetch = window.fetch;
    window.fetch = (input, init) => fetch.call(window, input instanceof Request ? new Request(rewrite(input.url), input) : rewrite(input), init);
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, ...args) { return open.call(this, method, rewrite(url), ...args); };
    for (const name of ['WebSocket', 'EventSource']) {
      const Native = window[name];
      if (Native) window[name] = class extends Native { constructor(url, ...args) { super(rewrite(url), ...args); } };
    }
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) { return setAttribute.call(this, name, /^(src|href|action|poster)$/i.test(name) ? rewrite(value) : value); };
    for (const [Type, property] of [[HTMLScriptElement,'src'],[HTMLImageElement,'src'],[HTMLLinkElement,'href'],[HTMLFormElement,'action']]) {
      const descriptor = Object.getOwnPropertyDescriptor(Type.prototype, property);
      if (descriptor?.set) Object.defineProperty(Type.prototype, property, {...descriptor, set(value) { descriptor.set.call(this, rewrite(value)); }});
    }
    document.addEventListener('click', event => { const a = event.target.closest?.('a[href]'); if (a) a.setAttribute('href', a.getAttribute('href')); }, true);
    document.addEventListener('submit', event => { const form = event.target; if (form instanceof HTMLFormElement) form.action = rewrite(form.action); }, true);
  })();`
}

export function rewritePreviewText(source: string, contentType: string, port: number): string {
  if (/javascript|ecmascript/.test(contentType)) return rewriteModule(source, port)
  if (/text\/css/.test(contentType)) return source.replace(/(url\(\s*["']?)([^\s)'"\r\n]+)|(@import\s*["'])([^"'\r\n]+)/g,
    (_all, start: string, path: string, importStart: string, importPath: string) => (start || importStart) + previewPath(port, path || importPath))
  if (!/text\/html/.test(contentType)) return source
  const html = source
    .replace(/(\b(?:src|href|action|poster)\s*=\s*)(["'])([^"']*)\2/gi, (_all, start: string, quote: string, path: string) => `${start}${quote}${previewPath(port, path)}${quote}`)
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (_all, start: string, body: string, end: string) => start + rewriteModule(body, port) + end)
  const adapter = `<script>${browserAdapter(port)}</script>`
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, head => head + adapter)
    : /^\s*<!doctype[^>]*>/i.test(html) ? html.replace(/^\s*<!doctype[^>]*>/i, doctype => doctype + adapter) : adapter + html
}
