// Pure game logic. No I/O, so it can be unit tested.

export const TIP_TYPES = [
  "In welcher Strasse bist du?",
  "Hast du mich gerade gesehen?",
  "In welche Richtung bist du gerade gelaufen?",
  "Bist du versteckt oder stehst du offen?",
];
export const MAX_TIPS = 3;
export const OUT_OF_ZONE_LIMIT_MS = 60 * 1000;
export const HIDE_HEAD_START_MS = 5 * 60 * 1000; // seekers wait this long after the start

// Round length presets in minutes.
export const ROUND_LENGTHS = [30, 60, 120];
// The host picks how many minutes pass between location pings.
export const PING_INTERVALS = [1, 2, 3, 5, 10];
export const MAX_PING_INTERVAL_MIN = 30;

// Runners may pick one of these when the host allowed vehicles.
export const VEHICLES = [
  "Roller",
  "Fahrrad",
  "Skateboard",
  "Longboard",
  "E-Bike",
  "E-Roller",
  "Hoverboard",
  "Inliner / Rollschuhe",
];

export function distanceM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function makePlayer({ id, name, phone, role }) {
  return {
    id,
    name,
    phone: phone || "",
    role, // seeker | runner
    status: "ok", // ok | tagged | lost
    tips: 0,
    calls: 0,
    facetimes: 0,
    vehicle: null,
    pingAt: null, // when this player last sent a location ping
  };
}

function assertLobby(room) {
  if (room.phase !== "lobby") throw new Error("game already started");
}

export function createRoom({
  hostId,
  hostName,
  hostPhone,
  hostRole,
  roundMinutes,
  zone,
  pingIntervalMin = 3,
  vehicles = false,
  tagging = true,
  advancedTips = false,
}) {
  if (!ROUND_LENGTHS.includes(Number(roundMinutes))) throw new Error("invalid round length");
  const interval = Number(pingIntervalMin);
  if (!Number.isFinite(interval) || interval < 1 || interval > MAX_PING_INTERVAL_MIN) {
    throw new Error("invalid ping interval");
  }
  const role = hostRole === "runner" ? "runner" : "seeker";
  return {
    code: Math.random().toString(36).slice(2, 8).toUpperCase(),
    hostId,
    phase: "lobby", // lobby | running | finished
    roundMinutes: Number(roundMinutes),
    pingIntervalMin: interval,
    vehicles: Boolean(vehicles),
    tagging: tagging !== false,
    advancedTips: Boolean(advancedTips),
    zone: {
      center: zone.center, // { lat, lng }, set at start by the hiders' area
      radiusM: zone.radiusM,
      growPerStepM: zone.growPerStepM || 0, // 0 = fixed zone
      stepMinutes: zone.stepMinutes || 10,
    },
    players: {
      [hostId]: makePlayer({ id: hostId, name: hostName, phone: hostPhone, role }),
    },
    startedAt: null,
    endsAt: null,
    seekersFreeAt: null,
    pingRequestAt: null, // set when a seeker asks for a ping of all runners
    pingRequestBy: null,
    outOfZoneSince: {},
    events: [],
    tips: [],
  };
}

export function addPlayer(room, { id, name, phone }) {
  assertLobby(room);
  if (room.players[id]) throw new Error("already in the room");
  room.players[id] = makePlayer({ id, name, phone, role: "runner" });
  return room;
}

export function setRole(room, playerId, role, actorId) {
  if (actorId !== room.hostId) throw new Error("only host");
  assertLobby(room);
  if (!room.players[playerId]) throw new Error("unknown player");
  if (role !== "seeker" && role !== "runner") throw new Error("invalid role");
  room.players[playerId].role = role;
  room.players[playerId].vehicle = null;
  return room;
}

// Host removes a player from the lobby.
export function kickPlayer(room, actorId, targetId) {
  if (actorId !== room.hostId) throw new Error("only host");
  assertLobby(room);
  if (targetId === room.hostId) throw new Error("host cannot be kicked");
  const kicked = room.players[targetId];
  if (!kicked) throw new Error("unknown player");
  delete room.players[targetId];
  delete room.outOfZoneSince[targetId];
  logEvent(room, Date.now(), `${kicked.name} wurde rausgeworfen`);
  return room;
}

// A player leaves. The host role moves on to the next player.
export function leaveRoom(room, playerId) {
  if (!room.players[playerId]) return Object.keys(room.players).length === 0;
  delete room.players[playerId];
  delete room.outOfZoneSince[playerId];
  const rest = Object.keys(room.players);
  if (room.hostId === playerId && rest.length) room.hostId = rest[0];
  return rest.length === 0;
}

// Shuffle roles so every player has a chance to hide. Always keeps at least one seeker and one runner.
export function randomizeRoles(room, actorId, rng = Math.random) {
  if (actorId !== room.hostId) throw new Error("only host");
  assertLobby(room);
  const ids = Object.keys(room.players);
  if (ids.length < 2) throw new Error("need at least two players");
  const shuffled = ids.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const seekerCount = 1 + Math.floor(rng() * (ids.length - 1)); // 1 .. n-1
  shuffled.forEach((id, index) => {
    room.players[id].role = index < seekerCount ? "seeker" : "runner";
    room.players[id].vehicle = null;
  });
  return room;
}

export function startRound(room, actorId, now) {
  if (actorId !== room.hostId) throw new Error("only host");
  if (room.phase !== "lobby") throw new Error("already started");
  const runners = Object.values(room.players).filter((p) => p.role === "runner");
  const seekers = Object.values(room.players).filter((p) => p.role === "seeker");
  if (runners.length === 0) throw new Error("need at least one runner");
  if (seekers.length === 0) throw new Error("need at least one seeker");
  room.phase = "running";
  room.startedAt = now;
  room.endsAt = now + room.roundMinutes * 60 * 1000;
  room.seekersFreeAt = now + HIDE_HEAD_START_MS;
  room.pingRequestAt = null;
  room.pingRequestBy = null;
  room.outOfZoneSince = {};
  room.events = [];
  room.tips = [];
  for (const p of Object.values(room.players)) {
    p.status = "ok";
    p.tips = 0;
    p.calls = 0;
    p.facetimes = 0;
    p.pingAt = null;
    p.vehicle = null;
    delete p.pos;
  }
  logEvent(room, now, "Runde gestartet");
  return room;
}

// Host starts a new round with the same players.
export function resetRound(room, actorId) {
  if (actorId !== room.hostId) throw new Error("only host");
  if (room.phase !== "finished") throw new Error("round not finished");
  room.phase = "lobby";
  room.startedAt = null;
  room.endsAt = null;
  room.seekersFreeAt = null;
  room.pingRequestAt = null;
  room.pingRequestBy = null;
  room.outOfZoneSince = {};
  room.events = [];
  room.tips = [];
  for (const p of Object.values(room.players)) {
    p.status = "ok";
    p.tips = 0;
    p.calls = 0;
    p.facetimes = 0;
    p.pingAt = null;
    p.vehicle = null;
    delete p.pos;
  }
  return room;
}

export function pingIntervalMs(room) {
  return room.pingIntervalMin * 60 * 1000;
}

// Timestamp of the next location ping. Pings sit on a fixed clock: start + n * interval.
export function nextPingAt(room, now) {
  if (room.phase !== "running" || room.startedAt == null) return null;
  const step = pingIntervalMs(room);
  const stepIndex = Math.floor(Math.max(0, now - room.startedAt) / step) + 1;
  return room.startedAt + stepIndex * step;
}

// Seekers may not act until the hiders' head start is over.
function assertSeekerFree(room, now) {
  if (room.seekersFreeAt != null && now < room.seekersFreeAt) throw new Error("seekers still hiding");
}

// Zone radius, growing by growPerStepM every stepMinutes when enabled.
export function zoneRadius(room, now) {
  const z = room.zone;
  if (!z.growPerStepM || room.startedAt == null) return z.radiusM;
  const steps = Math.floor((now - room.startedAt) / (z.stepMinutes * 60 * 1000));
  return z.radiusM + steps * z.growPerStepM;
}

function logEvent(room, now, text) {
  room.events.push({ at: now, text });
  if (room.events.length > 60) room.events.splice(0, room.events.length - 60);
}

// A runner sends a location ping. Positions are not live: early updates are ignored,
// unless the ping was forced (advanced tip "Standort-Ping").
export function reportLocation(room, playerId, pos, now, { forced = false } = {}) {
  const p = room.players[playerId];
  if (!p) throw new Error("unknown player");
  if (p.role === "runner" && room.phase === "running" && !forced) {
    if (p.pingAt != null && now - p.pingAt < pingIntervalMs(room) * 0.8) return room;
  }
  p.pos = { lat: pos.lat, lng: pos.lng, at: now };
  if (p.role === "runner") p.pingAt = now;
  if (p.role === "runner" && p.status === "ok" && room.phase === "running") {
    const d = distanceM(pos, room.zone.center);
    if (d > zoneRadius(room, now)) {
      room.outOfZoneSince[playerId] ??= now;
      if (now - room.outOfZoneSince[playerId] > OUT_OF_ZONE_LIMIT_MS) {
        p.status = "lost";
        logEvent(room, now, `${p.name} hat verloren (zu lange ausserhalb der Zone)`);
      }
    } else {
      delete room.outOfZoneSince[playerId];
    }
  }
  return room;
}

// A seeker tags a runner. With tagging on, the tagged runner becomes a seeker.
export function tag(room, seekerId, runnerId, now) {
  if (room.phase !== "running") throw new Error("round not running");
  const seeker = room.players[seekerId];
  const runner = room.players[runnerId];
  if (!seeker || !runner) throw new Error("unknown player");
  if (seeker.role !== "seeker" || runner.role !== "runner") throw new Error("invalid roles");
  assertSeekerFree(room, now);
  if (runner.status !== "ok") throw new Error("runner not active");
  // Without tagging the runner is just caught and sits out the rest of the round.
  if (!room.tagging) {
    runner.status = "tagged";
    logEvent(room, now, `${runner.name} wurde getickt`);
    checkEnd(room, now);
    return room;
  }
  convertToSeeker(room, runner, now, `${runner.name} wurde getickt und sucht jetzt mit`);
  return room;
}

// A runner reports itself as tagged (honour system).
export function confirmTagged(room, runnerId, now) {
  const runner = room.players[runnerId];
  if (!runner || runner.role !== "runner") throw new Error("invalid runner");
  if (room.phase !== "running") throw new Error("round not running");
  if (runner.status !== "ok") throw new Error("runner not active");
  if (!room.tagging) {
    runner.status = "tagged";
    logEvent(room, now, `${runner.name} wurde getickt`);
    checkEnd(room, now);
    return room;
  }
  convertToSeeker(room, runner, now, `${runner.name} wurde getickt und sucht jetzt mit`);
  return room;
}

function convertToSeeker(room, runner, now, text) {
  runner.role = "seeker";
  runner.status = "ok";
  runner.vehicle = null;
  runner.tips = 0;
  runner.pingAt = null;
  delete room.outOfZoneSince[runner.id];
  logEvent(room, now, text);
  checkEnd(room, now);
}

// Calling is always allowed: no limits, no minimum distance.
export function contact(room, seekerId, runnerId, kind, now) {
  const seeker = room.players[seekerId];
  const runner = room.players[runnerId];
  if (!seeker || !runner || seeker.role !== "seeker" || runner.role !== "runner") throw new Error("invalid roles");
  if (runner.status !== "ok") throw new Error("runner not active");
  if (kind !== "call" && kind !== "facetime") throw new Error("invalid kind");
  seeker[kind === "call" ? "calls" : "facetimes"] += 1;
  logEvent(room, now, `${seeker.name} ${kind === "call" ? "ruft an" : "startet FaceTime mit"} ${runner.name}`);
  return room;
}

// Seeker requests one of the fixed tips from a runner (max MAX_TIPS per seeker).
export function requestTip(room, seekerId, runnerId, tipIndex, now) {
  const seeker = room.players[seekerId];
  const runner = room.players[runnerId];
  if (!seeker || !runner || seeker.role !== "seeker" || runner.role !== "runner") throw new Error("invalid roles");
  assertSeekerFree(room, now);
  if (seeker.tips >= MAX_TIPS) throw new Error("no tips left");
  if (!TIP_TYPES[tipIndex]) throw new Error("invalid tip");
  seeker.tips += 1;
  room.tips.push({ id: room.tips.length + 1, seekerId, targetId: runnerId, tipIndex, askedAt: now, answer: null });
  logEvent(room, now, `${seeker.name} fragt ${runner.name}: ${TIP_TYPES[tipIndex]}`);
  return room;
}

// The runner answers a tip request. Answers are stored on the request and shown to the seeker.
export function answerTip(room, runnerId, tipId, answer, now) {
  const runner = room.players[runnerId];
  if (!runner || runner.role !== "runner") throw new Error("invalid runner");
  const text = String(answer || "").trim().slice(0, 200);
  if (!text) throw new Error("empty answer");
  const tip = room.tips.find((t) => t.id === tipId && t.targetId === runnerId);
  if (!tip) throw new Error("unknown tip");
  if (tip.answer) throw new Error("already answered");
  tip.answer = text;
  tip.answeredAt = now;
  logEvent(room, now, `${runner.name} antwortet auf: ${TIP_TYPES[tip.tipIndex]}`);
  return room;
}

// Advanced tip: a seeker asks every runner for an immediate location ping.
export function requestLocationPing(room, seekerId, now) {
  const seeker = room.players[seekerId];
  if (!seeker || seeker.role !== "seeker") throw new Error("invalid seeker");
  if (!room.advancedTips) throw new Error("advanced tips are off");
  if (room.phase !== "running") throw new Error("round not running");
  assertSeekerFree(room, now);
  room.pingRequestAt = now;
  room.pingRequestBy = seekerId;
  logEvent(room, now, `${seeker.name} fordert einen Standort-Ping aller Verstecker an`);
  return room;
}

// Runners announce which vehicle they use. Allowed at any time during the round.
export function setVehicle(room, playerId, vehicle, now) {
  if (!room.vehicles) throw new Error("vehicles are off");
  const p = room.players[playerId];
  if (!p) throw new Error("unknown player");
  if (p.role !== "runner") throw new Error("only runners use vehicles");
  if (room.phase !== "running") throw new Error("round not running");
  if (p.status !== "ok") throw new Error("runner not active");
  if (vehicle != null && !VEHICLES.includes(vehicle)) throw new Error("unknown vehicle");
  p.vehicle = vehicle || null;
  delete room.outOfZoneSince[playerId];
  logEvent(room, now, vehicle ? `${p.name} nutzt ${vehicle}` : `${p.name} ist zu Fuss unterwegs`);
  return room;
}

// Round ends when time is up or when no runner is left. Remaining runners win.
export function checkEnd(room, now) {
  if (room.phase !== "running") return room;
  const active = Object.values(room.players).filter((p) => p.role === "runner" && p.status === "ok");
  if (now >= room.endsAt || active.length === 0) {
    room.phase = "finished";
    const winners = active.map((p) => p.name);
    logEvent(
      room,
      now,
      winners.length ? `Verstecker gewinnen: ${winners.join(", ")}` : "Sucher gewinnen – alle Verstecker wurden getickt"
    );
  }
  return room;
}
