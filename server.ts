import http from "http";
import next from "next";
import WebSocket, { WebSocketServer } from "ws";
import { randomUUID } from "crypto";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev });
const handle = app.getRequestHandler();

type Room = {
  roomId: string;
  hostId: string | null;
  currentTime: number;
  isPlaying: boolean;
  updatedAt: number;
  clients: Set<WebSocket>;
};

type ClientMeta = {
  clientId: string;
  roomId: string | null;
  isHost: boolean;
};

const rooms = new Map<string, Room>();
const clientMeta = new WeakMap<WebSocket, ClientMeta>();

function getRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      roomId,
      hostId: null,
      currentTime: 0,
      isPlaying: false,
      updatedAt: Date.now(),
      clients: new Set(),
    };
    rooms.set(roomId, room);
  }
  return room;
}

function safeSend(ws: WebSocket, data: unknown) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(data));
}

function broadcast(room: Room, data: unknown, except?: WebSocket) {
  for (const client of room.clients) {
    if (client === except) continue;
    safeSend(client, data);
  }
}

function setHost(room: Room, newHost: WebSocket | null) {
  room.hostId = newHost ? clientMeta.get(newHost)?.clientId || null : null;
  for (const client of room.clients) {
    const meta = clientMeta.get(client);
    if (!meta) continue;
    meta.isHost = client === newHost;
    safeSend(client, { type: "host", isHost: meta.isHost });
  }
}

function getCurrentTime(room: Room) {
  if (!room.isPlaying) return room.currentTime;
  const delta = (Date.now() - room.updatedAt) / 1000;
  return room.currentTime + Math.max(0, delta);
}

app.prepare().then(() => {
  const server = http.createServer((req, res) => handle(req, res));
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/ws")) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    const clientId = randomUUID();
    clientMeta.set(ws, { clientId, roomId: null, isHost: false });

    ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const meta = clientMeta.get(ws);
      if (!meta) return;

      if (msg?.type === "join_room") {
        const roomId = String(msg.roomId || "").trim();
        if (!roomId) return;

        if (meta.roomId) {
          const prevRoom = rooms.get(meta.roomId);
          if (prevRoom) prevRoom.clients.delete(ws);
        }

        const room = getRoom(roomId);
        room.clients.add(ws);
        meta.roomId = roomId;

        if (!room.hostId) {
          meta.isHost = true;
          room.hostId = meta.clientId;
        } else {
          meta.isHost = room.hostId === meta.clientId;
        }

        safeSend(ws, {
          type: "joined",
          roomId,
          clientId: meta.clientId,
          isHost: meta.isHost,
        });
        safeSend(ws, {
          type: "state",
          currentTime: getCurrentTime(room),
          isPlaying: room.isPlaying,
        });
        return;
      }

      const roomId = meta.roomId;
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;

      if (msg?.type === "sync_request") {
        safeSend(ws, {
          type: "state",
          currentTime: getCurrentTime(room),
          isPlaying: room.isPlaying,
        });
        return;
      }

      if (!meta.isHost) return;

      if (msg?.type === "play") {
        room.currentTime = Number(msg.currentTime || 0);
        room.isPlaying = true;
        room.updatedAt = Date.now();
        broadcast(room, { type: "play", currentTime: room.currentTime }, ws);
        return;
      }

      if (msg?.type === "pause") {
        room.currentTime = Number(msg.currentTime || 0);
        room.isPlaying = false;
        room.updatedAt = Date.now();
        broadcast(room, { type: "pause", currentTime: room.currentTime }, ws);
        return;
      }

      if (msg?.type === "seek") {
        room.currentTime = Number(msg.currentTime || 0);
        room.updatedAt = Date.now();
        broadcast(room, { type: "seek", currentTime: room.currentTime }, ws);
        return;
      }
    });

    ws.on("close", () => {
      const meta = clientMeta.get(ws);
      if (!meta?.roomId) return;

      const room = rooms.get(meta.roomId);
      if (!room) return;

      room.clients.delete(ws);

      if (room.hostId === meta.clientId) {
        const nextHost = room.clients.values().next().value || null;
        setHost(room, nextHost || null);
      }

      if (room.clients.size === 0) {
        rooms.delete(meta.roomId);
      }
    });
  });

  server.listen(port, () => {
    console.log(`Server ready on http://localhost:${port}`);
  });
});
