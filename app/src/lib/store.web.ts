// Browser demo: SecureStore doesn't exist on the web, so keep things in localStorage.
const ls = () => (typeof localStorage === 'undefined' ? null : localStorage);

export async function getItemAsync(key: string) {
  return ls()?.getItem(key) ?? null;
}

export async function setItemAsync(key: string, value: string) {
  ls()?.setItem(key, value);
}

export async function deleteItemAsync(key: string) {
  ls()?.removeItem(key);
}
