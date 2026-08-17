import { io, Socket } from 'socket.io-client';
import { API_URL } from './api';

let socket: Socket | null = null;

// Socket.IO rooms are tied to the underlying transport connection — a
// reconnect (network blip, laptop sleep) gets a new socket.id server-side
// and silently drops room membership. Now that captions:complete carries
// the only copy of a project's captions (no Mongo to re-fetch from), a
// missed room-rejoin would mean that payload is never delivered. Track
// joined rooms so `connect` (including reconnects) can restore them.
const joinedRooms = new Set<string>();

export function getSocket() {
  if (!socket) {
    socket = io(API_URL, {
      autoConnect: false,
      // Auth cookie rides along automatically (withCredentials) — the
      // server reads it from the handshake's Cookie header.
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      timeout: 20_000,
    });
    socket.on('connect', () => {
      for (const projectId of joinedRooms) socket!.emit('project:join', projectId);
    });
  }
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
}

export function joinProjectRoom(projectId: string) {
  const s = connectSocket();
  joinedRooms.add(projectId);
  s.emit('project:join', projectId);
}

export function leaveProjectRoom(projectId: string) {
  joinedRooms.delete(projectId);
  socket?.emit('project:leave', projectId);
}
