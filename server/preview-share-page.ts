import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { PreviewShareError, type PreviewShares } from './preview-shares.js'

export const SHARE_EXCHANGE = '/__codex_preview_share__/exchange'
// This document has no app bundle or upstream content. Capture/clear the fragment
// before any await; never put the reusable capability on the untrusted origin.
const script = `(()=>{let token=location.hash.slice(1);history.replaceState(null,'',location.pathname);const output=document.getElementById('status');(async()=>{try{if(!/^[a-f0-9-]{36}\\.[A-Za-z0-9_-]{43}$/.test(token))throw Error();const body=JSON.stringify({token});token='';const r=await fetch('${SHARE_EXCHANGE}',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error();const d=await r.json();const target=new URL(d.url);if(target.protocol!=='https:'||target.pathname!=='/__codex_preview__/share-redeem'||target.search||target.hash||typeof d.ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(d.ticket))throw Error();const form=document.createElement('form');form.method='POST';form.action=target.href;const input=document.createElement('input');input.type='hidden';input.name='ticket';input.value=d.ticket;form.append(input);document.body.append(form);form.submit()}catch{token='';output.textContent='Link không hợp lệ, đã hết hạn hoặc bị ngắt. Hãy mở lại link gốc hoặc liên hệ người chia sẻ.'}})()})()`
export const SHARE_PAGE = `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin"><title>Mở link chia sẻ</title><body><p id="status" role="status">Đang mở dịch vụ được chia sẻ…</p><noscript>Cần bật JavaScript để mở link.</noscript><script>${script}</script></body></html>`
export const SHARE_PAGE_CSP = `default-src 'none'; script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`

let reading = 0
/** Constant global admission bound, byte bound and deadline; no attacker-keyed map. */
export async function readShareBody(req: IncomingMessage): Promise<string> {
  if (reading >= 32) throw new PreviewShareError(503, 'Share opening is busy. Retry shortly.')
  if (req.headers['content-encoding']) throw new PreviewShareError(415, 'Encoded share requests are not supported')
  reading++
  try {
    return await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []; let size = 0
      const timer = setTimeout(() => done(new PreviewShareError(408, 'Share opening timed out')), 10_000); timer.unref()
      const data = (chunk: Buffer) => { size += chunk.length; if (size > 2048) done(new PreviewShareError(413, 'Share request is too large')); else chunks.push(Buffer.from(chunk)) }
      const end = () => done(undefined, Buffer.concat(chunks).toString('utf8'))
      const aborted = () => done(new PreviewShareError(400, 'Share request ended'))
      const done = (error?: Error, value?: string) => {
        clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', aborted); req.off('aborted', aborted)
        if (error) { req.resume(); reject(error) } else resolve(value!)
      }
      req.on('data', data); req.once('end', end); req.once('error', aborted); req.once('aborted', aborted)
    })
  } finally { reading-- }
}

export async function publicShareRequest(req: IncomingMessage, res: ServerResponse, origin: string, shares?: PreviewShares): Promise<void> {
  const url = new URL(req.url ?? '/', origin)
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'strict-origin', 'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY', 'Content-Security-Policy': `${SHARE_PAGE_CSP}; form-action ${shares?.formOrigins() ?? "'none'"}`, 'Cross-Origin-Opener-Policy': 'same-origin' }
  try {
    if (url.search) throw new PreviewShareError(400, 'Use the original share link')
    if (url.pathname === '/preview/share' && req.method === 'GET') {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' }); res.end(SHARE_PAGE); return
    }
    if (url.pathname !== SHARE_EXCHANGE || req.method !== 'POST') throw new PreviewShareError(405, 'Invalid share request')
    if (req.headers.origin !== origin) throw new PreviewShareError(403, 'Share origin is not allowed')
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw new PreviewShareError(415, 'Use JSON')
    const body = await readShareBody(req)
    if (req.aborted || res.destroyed) return
    let value
    try { value = JSON.parse(body) } catch { throw new PreviewShareError(400, 'Invalid share request') }
    if (!shares) throw new PreviewShareError(503, 'Sharing is not configured')
    const result = shares.exchange(value?.token)
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(result))
  } catch (error) {
    if (res.destroyed || res.writableEnded) return
    const status = error instanceof PreviewShareError ? error.status : 400
    res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', ...(status === 429 || status === 503 ? { 'Retry-After': '60' } : {}) })
    res.end(error instanceof PreviewShareError ? error.message : 'Invalid share request')
  }
}
