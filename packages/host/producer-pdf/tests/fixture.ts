function objectOffset(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export function minimalPdf(text = 'TiggyPdfKeyword'): Uint8Array {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')
  const stream = `BT /F1 14 Tf 72 720 Td (${escaped}) Tj ET`
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj',
    `5 0 obj\n<< /Length ${objectOffset(stream)} >>\nstream\n${stream}\nendstream\nendobj`,
  ]
  let output = '%PDF-1.4\n'
  const offsets = [0]
  for (const object of objects) {
    offsets.push(objectOffset(output))
    output += `${object}\n`
  }
  const xrefOffset = objectOffset(output)
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  output += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return new TextEncoder().encode(output)
}
