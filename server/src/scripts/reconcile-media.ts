import { supabase } from '../config/supabase.js';
import { imagekit } from '../config/imagekit.js';
import { logger } from '../utils/logger.js';
// Only candidates already present in the historical field are examined.
// The provider's ID, URL, and room folder must all agree before adoption.
const apply = process.argv.includes('--apply');
let offset = 0;
let verified = 0;
let unresolved = 0;
while (true) {
  const { data, error } = await supabase.from('messages').select('id, file_path, file_url, room_id, rooms(code)').is('file_id', null).not('file_path', 'is', null).order('id').range(offset, offset + 99);
  if (error) throw new Error('Legacy media scan failed');
  if (!data?.length) break;
  const valid: Array<{ id: string; fileId: string }> = [];
  for (const row of data) {
    if (!/^[a-f0-9]{24}$/i.test(row.file_path)) { unresolved += 1; continue; }
    try {
      const details = await imagekit.getFileDetails(row.file_path);
      const room = row.rooms as unknown as { code: string } | null;
      if (!room || details.fileId !== row.file_path || details.url !== row.file_url || !details.filePath.startsWith(`/nullchannel/${room.code.toLowerCase()}/`)) { unresolved += 1; continue; }
      valid.push({ id: row.id, fileId: details.fileId }); verified += 1;
    } catch { unresolved += 1; }
  }
  if (apply) {
    for (const item of valid) {
      const { error: updateError } = await supabase.from('messages').update({ file_id: item.fileId }).eq('id', item.id).is('file_id', null);
      if (updateError) throw new Error('Legacy media update failed');
    }
    // Applied rows disappear from this query; unresolved rows remain.
    offset += data.length - valid.length;
  } else offset += data.length;
}
logger.info('legacy_media_reconciliation', { mode: apply ? 'apply' : 'dry-run', verified, unresolved });
