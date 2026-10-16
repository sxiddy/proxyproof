import { api } from './api';

/** Browser demo: there's no share sheet, so just download the CSV. */
export async function shareCsv(path: string, filename: string) {
  const csv = await api<string>(path);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^\w.-]+/g, '-');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
