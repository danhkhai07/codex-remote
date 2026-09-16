/** Only passive raster formats receive a preview; HTML, SVG and other files stay opaque. */
export function isPreviewImage(file: Pick<File, 'type'>): boolean {
  return ['image/png', 'image/jpeg', 'image/webp'].includes(file.type.toLowerCase())
}
