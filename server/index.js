import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as game from "./game.js";

const PORT = Number(process.env.PORT || 3000);
const rooms = new Map();

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 10_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
  });
}

// Hiders must not see where the seekers are, so their positions are stripped for runner viewers.
function publicRoom(room, viewerId) {
  const viewer = room.players[viewerId];
  const hideSeekerPos = viewer?.role === "runner";
  const players = Object.fromEntries(
    Object.entries(room.players).map(([id, p]) => {
      if (hideSeekerPos && p.role === "seeker") {
        const { pos, ...rest } = p;
        return [id, rest];
      }
      return [id, p];
    })
  );
  return { ...room, players, outOfZoneSince: undefined };
}

export function handle(method, url, body, now = Date.now()) {
  const parsed = new URL(url, "http://localhost");
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api") return [404, { error: "not found" }];
  if (method === "GET" && parts.length === 2 && parts[1] === "health") return [200, { ok: true }];

  if (method === "POST" && parts.length === 2 && parts[1] === "rooms") {
    try {
      const playerId = randomUUID();
      const room = game.createRoom({
        hostId: playerId,
        hostName: body.name || "Host",
        hostPhone: body.phone,
        roundMinutes: body.roundMinutes,
        tagMode: body.tagMode,
        zone: body.zone,
      });
      rooms.set(room.code, room);
      return [201, { code: room.code, playerId }];
    } catch (e) {
      return [400, { error: e.message }];
    }
  }

  const room = rooms.get(parts[2]);
  if (!room) return [404, { error: "room not found" }];
  const action = parts[3];

  try {
    if (method === "GET" && !action) {
      game.checkEnd(room, now);
      return [200, { room: publicRoom(room, parsed.searchParams.get("playerId")), now }];
    }
    if (method === "POST" && action === "join") {
      const playerId = randomUUID();
      game.addPlayer(room, { id: playerId, name: body.name || "Spieler", phone: body.phone });
      return [201, { playerId }];
    }
    if (method === "POST" && action === "start") {
      game.startRound(room, body.playerId, now);
      return [200, { ok: true }];
    }
    if (method === "POST" && action === "reset") {
      game.resetRound(room, body.playerId);
      return [200, { ok: true }];
    }
    if (method === "POST" && action === "role") {
      game.setRole(room, body.targetId, body.role, body.playerId);
      return [200, { ok: true }];
    }
    if (method === "POST" && action === "location") {
      game.reportLocation(room, body.playerId, body, now);
      return [200, { ok: true }];
    }
    if (method === "POST" && action === "tag") {
      game.tag(room, body.playerId, body.targetId, now);
      return [200, { ok: true }];
    }
    if (method === "POST" && action === "confirm-tagged") {
      game.confirmTagged(room, body.playerId, now);
      return [200, { ok: true }];
    }
    if (method === "POST" && action === "contact") {
      game.contact(room, body.playerId, body.targetId, body.kind, now);
      return [200, { ok: true }];
    }
    if (method === "POST" && action === "tip") {
      game.requestTip(room, body.playerId, body.targetId, body.tipIndex, now);
      return [200, { ok: true }];
    }
    if (method === "POST" && action === "tip-answer") {
      game.answerTip(room, body.playerId, body.tipId, body.answer, now);
      return [200, { ok: true }];
    }
    return [404, { error: "unknown action" }];
  } catch (e) {
    return [400, { error: e.message }];
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const urlPath = req.url.split("?")[0];
    if (req.method === "GET" && !urlPath.startsWith("/api")) {
      return serveStatic(urlPath, res);
    }
    const body = req.method === "POST" ? await readBody(req) : {};
    const [status, payload] = handle(req.method, req.url, body);
    send(res, status, payload);
  } catch (e) {
    send(res, 400, { error: e.message });
  }
});

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json" };

function serveStatic(urlPath, res) {
  const root = path.resolve("dist");
  const file = path.join(root, urlPath === "/" ? "index.html" : urlPath);
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root, "index.html");
  if (!fs.existsSync(target)) {
    res.writeHead(404);
    return res.end("not built");
  }
  res.writeHead(200, { "content-type": MIME[path.extname(target)] || "application/octet-stream" });
  fs.createReadStream(target).pipe(res);
}

if (process.argv[1] && process.argv[1].endsWith("index.js")) {
  server.listen(PORT, () => console.log(`Server läuft auf http://localhost:${PORT}`));
}

export { server, rooms };
