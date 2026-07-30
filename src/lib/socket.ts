import { io, Socket } from 'socket.io-client';
import { API_URL, getAccessToken } from './api';

let socket: Socket | null = null;

export function getSocket() {
  if (!socket) {
    socket = io(API_URL, {
      autoConnect: false,
      withCredentials: true,
      auth: { token: getAccessToken() },
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      timeout: 20_000,
    });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  s.auth = { token: getAccessToken() };
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
}

export function joinProjectRoom(projectId: string) {
  const s = connectSocket();
  s.emit('project:join', projectId);
}

export function leaveProjectRoom(projectId: string) {
  socket?.emit('project:leave', projectId);
}
