import { extname } from 'node:path';
export const validSignature = (b: Buffer, mime: string) => {
  if (!b.length) return false;
  const hex = b.subarray(0, 16).toString('hex');
  const ascii = b.subarray(0, 16).toString('ascii');
  if (mime === 'image/png') return hex.startsWith('89504e470d0a1a0a');
  if (mime === 'image/jpeg') return hex.startsWith('ffd8ff');
  if (mime === 'image/webp') return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
  if (mime === 'audio/webm') return hex.startsWith('1a45dfa3');
  if (mime === 'audio/wav') return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE';
  if (mime === 'audio/mpeg' || mime === 'audio/mp3') return ascii.startsWith('ID3') || (b[0] === 255 && (b[1] & 224) === 224);
  if (mime === 'application/pdf') return ascii.startsWith('%PDF-');
  if (mime.includes('zip') || mime.includes('openxmlformats')) return hex.startsWith('504b0304') || hex.startsWith('504b0506');
  if (['application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint'].includes(mime)) return hex.startsWith('d0cf11e0a1b11ae1');
  if (mime === 'text/plain' || mime === 'text/csv') return !b.includes(0);
  return false;
};

export const normalizeMediaType = (mime: string, filename: string) => {
  if (mime && mime !== 'application/octet-stream') return mime;
  const types: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.webm': 'audio/webm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.csv': 'text/csv', '.zip': 'application/zip', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  };
  return types[extname(filename).toLowerCase()] ?? mime;
};
