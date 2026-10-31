// Pure game logic. No I/O, so it can be unit tested.

export const TAG_MODES = { 0: 0, 1: 1, 5: 5 }; // 0 = manual (runner presses button), 1 / 5 = metres
export const TIP_TYPES = [
  "In welcher Strasse bist du?",
  "Hast du mich gerade gesehen?",
  "In welche Richtung bist du gerade gelaufen?",
  "Bist du versteckt oder stehst du offen?",
];
export const MAX_TIPS = 3;
export const REPORT_INTERVAL_MS = 5 * 60 * 1000;
export const OUT_OF_ZONE_LIMIT_MS = 60 * 1000;
export const NO_CALL_RADIUS_M = 10;
export const HIDE_HEAD_START_MS = 5 * 60 * 1000; // seekers wait this long after the start

// Round length presets: calls and facetimes allowed per seeker.
export const ROUND_PRESETS = {
  30: { calls: 2, facetimes: 1 },
  60: { calls: 3, facetimes: 2 },
  120: { calls: 5, facetimes: 3 },
};

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

export function createRoom({ hostId, hostName, hostPhone, roundMinutes, tagMode, zone }) {
  if (!ROUND_PRESETS[roundMinutes]) throw new Error("invalid round length");
  if (!TAG_MODES[tagMode]) throw new Error("invalid tag mode");
  return {
    code: Math.random().toString(36).slice(2, 8).toUpperCase(),
    hostId,
    phase: "lobby", // lobby | running | finished
    roundMinutes,
    tagMode,
    limits: ROUND_PRESETS[roundMinutes],
    zone: {
      center: zone.center, // { lat, lng }, set at start by the hiders' area
      radiusM: zone.radiusM,
      growPerStepM: zone.growPerStepM || 0, // 0 = fixed zone
      stepMinutes: zone.stepMinutes || 10,
    },
    players: {
      [hostId]: { id: hostId, name: hostName, phone: hostPhone || "", role: "seeker", status: "ok", tips: 0, calls: 0, facetimes: 0 },
    },
    startedAt: null,
    endsAt: null,
    outOfZoneSince: {},
    events: [],
    tips: [],
  };
}

export function addPlayer(room, { id, name, phone }) {
  if (room.phase !== "lobby") throw new Error("game already started");
  room.players[id] = { id, name, phone: phone || "", role: "seeker", status: "ok", tips: 0, calls: 0, facetimes: 0 };
  return room;
}

export function setRole(room, playerId, role, actorId) {
  if (actorId !== room.hostId) throw new Error("only host");
  if (room.phase !== "lobby") throw new Error("game already started");
  if (!room.players[playerId]) throw new Error("unknown player");
  if (role !== "seeker" && role !== "runner") throw new Error("invalid role");
  room.players[playerId].role = role;
  return room;
}

export function startRound(room, actorId, now) {
  if (actorId !== room.hostId) throw new Error("only host");
  if (room.phase !== "lobby") throw new Error("already started");
  const runners = Object.values(room.players).filter((p) => p.role === "runner");
  if (runners.length === 0) throw new Error("need at least one runner");
  room.phase = "running";
  room.startedAt = now;
  room.endsAt = now + room.roundMinutes * 60 * 1000;
  room.nextReportAt = now + REPORT_INTERVAL_MS;
  room.seekersFreeAt = now + HIDE_HEAD_START_MS;
  return room;
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
}

// A runner reports its position. Position updates are accepted at any time.
export function reportLocation(room, playerId, pos, now) {
  const p = room.players[playerId];
  if (!p) throw new Error("unknown player");
  p.pos = { lat: pos.lat, lng: pos.lng, at: now };
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

// A seeker tries to tag a runner. Runner must be within the tag distance.
export function tag(room, seekerId, runnerId, now) {
  const seeker = room.players[seekerId];
  const runner = room.players[runnerId];
  if (!seeker || !runner) throw new Error("unknown player");
  if (seeker.role !== "seeker" || runner.role !== "runner") throw new Error("invalid roles");
  assertSeekerFree(room, now);
  if (room.tagMode === 0) throw new Error("manual mode: runner confirms tag");
  if (runner.status !== "ok") throw new Error("runner not active");
  if (!seeker.pos || !runner.pos) throw new Error("no location");
  if (distanceM(seeker.pos, runner.pos) > TAG_MODES[room.tagMode]) throw new Error("too far away");
  runner.status = "tagged";
  logEvent(room, now, `${runner.name} wurde getickt`);
  return room;
}

// A runner confirms it was tagged (manual mode, tagMode-independent).
export function confirmTagged(room, runnerId, now) {
  const runner = room.players[runnerId];
  if (!runner || runner.role !== "runner") throw new Error("invalid runner");
  if (runner.status !== "ok") throw new Error("runner not active");
  runner.status = "tagged";
  logEvent(room, now, `${runner.name} hat sich selbst als getickt gemeldet`);
  return room;
}

// Seeker calls or FaceTimes a runner. Blocked within NO_CALL_RADIUS_M.
export function contact(room, seekerId, runnerId, kind, now) {
  const seeker = room.players[seekerId];
  const runner = room.players[runnerId];
  if (!seeker || !runner || seeker.role !== "seeker" || runner.role !== "runner") throw new Error("invalid roles");
  if (runner.status !== "ok") throw new Error("runner not active");
  if (kind !== "call" && kind !== "facetime") throw new Error("invalid kind");
  assertSeekerFree(room, now);
  const key = kind === "call" ? "calls" : "facetimes";
  const limit = kind === "call" ? room.limits.calls : room.limits.facetimes;
  if (seeker[key] >= limit) throw new Error(`no ${kind}s left`);
  if (seeker.pos && runner.pos && distanceM(seeker.pos, runner.pos) < NO_CALL_RADIUS_M) {
    throw new Error("too close to call");
  }
  seeker[key] += 1;
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

// Round ends when time is up. Runners still "ok" win.
export function checkEnd(room, now) {
  if (room.phase !== "running") return room;
  const active = Object.values(room.players).filter((p) => p.role === "runner" && p.status === "ok");
  if (now >= room.endsAt || active.length === 0) {
    room.phase = "finished";
    const winners = active.map((p) => p.name);
    logEvent(room, now, winners.length ? `Verstecker gewinnen: ${winners.join(", ")}` : "Sucher gewinnen");
  }
  return room;
}
