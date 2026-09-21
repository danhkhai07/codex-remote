/** Preview/share callers must not trust an earlier file-info size after a race. */
export async function boundedBlob(response: Response, limit: number): Promise<Blob> {
  const oversized = () => Error('Tệp vượt giới hạn bộ nhớ xem trước/chia sẻ. Dùng Download trong trình duyệt hỗ trợ lưu trực tiếp.')
  if (!response.body) throw Error('Missing file body')
  if (Number(response.headers.get('content-length')) > limit) { await response.body.cancel(); throw oversized() }
  const reader = response.body.getReader(), parts: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.length
      if (size > limit) throw oversized()
      parts.push(new Uint8Array(next.value))
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  return new Blob(parts, { type: response.headers.get('content-type') ?? 'application/octet-stream' })
}
