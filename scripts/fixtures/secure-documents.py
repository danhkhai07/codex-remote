"""Generate tiny, real OOXML/PDF fixtures using only the standard library."""
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(sys.argv[1])

def package(name, parts):
    with ZipFile(root / name, 'w', ZIP_DEFLATED) as archive:
        for path, value in parts.items():
            archive.writestr(path, value)

def types(overrides):
    return '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + ''.join(f'<Override PartName="/{p}" ContentType="{t}"/>' for p, t in overrides) + '</Types>'

def rels(entries):
    return '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + ''.join(f'<Relationship Id="{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{t}" Target="{p}"/>' for i,t,p in entries) + '</Relationships>'

package('canary.docx', {
    '[Content_Types].xml': types([('word/document.xml', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')]),
    '_rels/.rels': rels([('rId1', 'officeDocument', 'word/document.xml')]),
    'word/document.xml': '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>PRIVATE DOCX CANARY</w:t></w:r></w:p><w:tbl><w:tblPr><w:tblW w:w="5000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2500"/><w:gridCol w:w="2500"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Cell One</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cell Two</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr></w:body></w:document>'
})
# Two slide PresentationML package, opened by the real isolated LibreOffice converter.
ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
slide = '<p:sld ' + ns + '><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="7315200" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2800"/><a:t>PRIVATE PPTX CANARY PAGE NUMBER</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'
package('canary.pptx', {
    '[Content_Types].xml': types([('ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml')] + [(f'ppt/slides/slide{i}.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml') for i in [1, 2]]),
    '_rels/.rels': rels([('rId1', 'officeDocument', 'ppt/presentation.xml')]),
    'ppt/presentation.xml': '<p:presentation ' + ns + '><p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels([('rId1', 'slide', 'slides/slide1.xml'), ('rId2', 'slide', 'slides/slide2.xml')]),
    'ppt/slides/slide1.xml': slide.replace('NUMBER', '1'),
    'ppt/slides/slide2.xml': slide.replace('NUMBER', '2'),
})
# A valid PDF with searchable text, two pages and exact xref offsets.
objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>']
for n in [1, 2]:
    objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents {5+n} 0 R >>')
objects.append('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
for n in [1, 2]:
    stream = f'BT /F1 24 Tf 50 700 Td (PRIVATE PDF CANARY PAGE {n}) Tj ET\n'
    objects.append(f'<< /Length {len(stream)} >>\nstream\n{stream}endstream')
data = b'%PDF-1.4\n'; offsets = [0]
for i, obj in enumerate(objects, 1):
    offsets.append(len(data)); data += f'{i} 0 obj\n{obj}\nendobj\n'.encode()
xref = len(data)
data += f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode()
data += ''.join(f'{offset:010} 00000 n \n' for offset in offsets[1:]).encode()
data += f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
(root / 'canary.pdf').write_bytes(data)
