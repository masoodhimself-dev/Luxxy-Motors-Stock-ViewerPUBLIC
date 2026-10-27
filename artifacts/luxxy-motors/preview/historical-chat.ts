/** Read existing local conversation history without reopening chat or flushing old writes. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function readPreviewChatRecords() {
  const path = fileURLToPath(new URL('../../../.local/website-chat-preview.json', import.meta.url));
  try {
    const data = JSON.parse(await readFile(path, 'utf8'));
    return (Array.isArray(data?.state?.records) ? data.state.records : []).map((record: { conversation: Record<string, any>; messages: any[] }) => ({ conversation: record.conversation, messages: Array.isArray(record.messages) ? record.messages : [] }));
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
