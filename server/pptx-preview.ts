import { execFile } from 'node:child_process'
import { chown, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { MAX_PPTX_PREVIEW_BYTES, openInspectedFile, ServerFileError, type ServerFileInfo } from './server-files.js'

const exec = promisify(execFile)
const MAX_PDF_BYTES = 32 * 1024 * 1024

// A separate, unprivileged systemd unit cannot access the workspace or network.
// Its cgroup owns all converter children and enforces the memory/time limits.
export async function convertPptx(file: ServerFileInfo): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-pptx-'))
  try {
    const source = await openInspectedFile(file)
    try {
      const metadata = await source.stat()
      if (!metadata.isFile() || metadata.size > MAX_PPTX_PREVIEW_BYTES) throw new ServerFileError(413, 'PPTX quá lớn để xem trước (tối đa 20 MB).')
      if (metadata.size !== file.size || metadata.mtime.toISOString() !== file.modifiedAt) throw new ServerFileError(409, 'Tệp vừa thay đổi. Hãy mở lại bản xem trước.')
      await writeFile(join(directory, 'slides.pptx'), await source.readFile(), { mode: 0o644 })
    } finally { await source.close() }
    await chown(join(directory, 'slides.pptx'), 65534, 65534)
    await chown(directory, 65534, 65534)
    try {
      await exec('/usr/bin/systemd-run', [
        '--quiet', '--wait', '--collect', '--pipe',
        '-p', 'User=nobody', '-p', 'Group=nogroup',
        '-p', 'PrivateNetwork=yes', '-p', 'ProtectSystem=strict', '-p', 'ProtectHome=yes',
        '-p', 'PrivateTmp=yes', '-p', 'NoNewPrivileges=yes', '-p', 'PrivateDevices=yes',
        '-p', 'RestrictSUIDSGID=yes', '-p', 'RestrictAddressFamilies=AF_UNIX',
        '-p', 'MemoryMax=256M', '-p', 'MemorySwapMax=0', '-p', 'CPUQuota=50%',
        '-p', 'TasksMax=64', '-p', 'RuntimeMaxSec=45', '-p', 'TimeoutStopSec=2',
        '-p', 'LimitFSIZE=67108864', '-p', `BindPaths=${directory}:/work`,
        '--setenv=HOME=/work', '--setenv=SAL_USE_VCLPLUGIN=svp', '--setenv=GSETTINGS_BACKEND=memory',
        '/usr/bin/libreoffice', '-env:UserInstallation=file:///work/profile',
        '-env:UNO_SHARED_PACKAGES_CACHE=file:///work/shared-cache',
        '--headless', '--nologo', '--nodefault', '--norestore',
        '--convert-to', 'pdf:impress_pdf_Export', '--outdir', '/work', '/work/slides.pptx',
      ], { timeout: 55_000, maxBuffer: 64 * 1024 })
      const output = join(directory, 'slides.pdf')
      const metadata = await stat(output)
      if (metadata.size > MAX_PDF_BYTES) throw new ServerFileError(413, 'Bản xem trước quá lớn. Hãy tải PPTX gốc xuống.')
      const pdf = await readFile(output)
      if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('No PDF output')
      return pdf
    } catch (error) {
      if (error instanceof ServerFileError) throw error
      console.warn('PPTX preview conversion failed:', error instanceof Error ? error.message.slice(0, 1600) : 'Unknown converter error')
      throw new ServerFileError(422, 'Không chuyển được PPTX. Tệp có thể bị lỗi, có mật khẩu hoặc vượt giới hạn xử lý 45 giây. Bạn vẫn có thể tải tệp gốc.')
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
}

export class PptxPreviewCache {
  private cache = new Map<string, Buffer>()
  private pending: { key: string; promise: Promise<Buffer> } | null = null
  constructor(private convert = convertPptx) {}

  async get(file: ServerFileInfo): Promise<Buffer> {
    if (file.kind !== 'pptx') throw new ServerFileError(415, 'Chỉ hỗ trợ xem trước PPTX.')
    if (!file.previewable || file.size > MAX_PPTX_PREVIEW_BYTES) throw new ServerFileError(413, 'PPTX quá lớn để xem trước (tối đa 20 MB).')
    const key = JSON.stringify([file.path, file.size, file.modifiedAt])
    const hit = this.cache.get(key)
    if (hit) {
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }
    if (this.pending) {
      if (this.pending.key === key) return this.pending.promise
      throw new ServerFileError(429, 'Đang tạo bản xem trước khác. Vui lòng thử lại sau ít giây.')
    }
    const promise = this.convert(file).then(pdf => {
      if (pdf.length > MAX_PDF_BYTES) throw new ServerFileError(413, 'Bản xem trước quá lớn.')
      this.cache.set(key, pdf)
      while (this.cache.size > 3 || [...this.cache.values()].reduce((sum, item) => sum + item.length, 0) > MAX_PDF_BYTES) {
        this.cache.delete(this.cache.keys().next().value!)
      }
      return pdf
    }).finally(() => { this.pending = null })
    this.pending = { key, promise }
    return promise
  }
}
