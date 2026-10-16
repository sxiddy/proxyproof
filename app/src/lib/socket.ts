import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getApiUrl, getAuthToken } from './api';

let socket: Socket | null = null;
let socketFor = '';

export function getSocket() {
  const token = getAuthToken();
  const key = `${getApiUrl()}|${token}`;
  if (!socket || socketFor !== key) {
    socket?.disconnect();
    socket = io(getApiUrl(), { transports: ['websocket'], auth: { token }, reconnectionDelayMax: 4000 });
    socketFor = key;
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  socketFor = '';
}

/** Subscribe to socket events for the lifetime of a screen. */
export function useSocketEvents(handlers: Record<string, (payload: any) => void>, onConnect?: (s: Socket) => void) {
  const ref = useRef(handlers);
  const connectRef = useRef(onConnect);
  useEffect(() => {
    ref.current = handlers;
    connectRef.current = onConnect;
  });
  const names = Object.keys(handlers).sort().join(',');

  useEffect(() => {
    const s = getSocket();
    const bound = names.split(',').filter(Boolean).map((name) => {
      const fn = (p: any) => ref.current[name]?.(p);
      s.on(name, fn);
      return [name, fn] as const;
    });
    // Re-join rooms after every reconnect, not only the first connect.
    const handleConnect = () => connectRef.current?.(s);
    s.on('connect', handleConnect);
    if (s.connected) handleConnect();
    return () => {
      bound.forEach(([name, fn]) => s.off(name, fn));
      s.off('connect', handleConnect);
    };
  }, [names]);
}
