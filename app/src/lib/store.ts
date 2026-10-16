// Small key-value store. On phones this is the encrypted SecureStore; the
// browser demo uses store.web.ts instead.
export { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';
