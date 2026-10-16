import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api } from './api';

/** Download a CSV from the API and open the share sheet (Drive, WhatsApp, email…). */
export async function shareCsv(path: string, filename: string) {
  const csv = await api<string>(path);
  const file = new File(Paths.cache, filename.replace(/[^\w.-]+/g, '-'));
  file.create({ overwrite: true });
  file.write(csv);
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this phone.");
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Send attendance sheet' });
}
