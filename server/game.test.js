import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRoom,
  addPlayer,
  setRole,
  kickPlayer,
  leaveRoom,
  randomizeRoles,
  startRound,
  resetRound,
  reportLocation,
  tag,
  confirmTagged,
  contact,
  requestTip,
  answerTip,
  requestLocationPing,
  setVehicle,
  checkEnd,
  zoneRadius,
  distanceM,
  nextPingAt,
  HIDE_HEAD_START_MS,
  VEHICLES,
} from "./game.js";

const T = HIDE_HEAD_START_MS + 1000; // a time after the hiders' head start

const C = { lat: 52.52, lng: 13.405 };
const at = (dLat) => ({ lat: C.lat + dLat, lng: C.lng }); // ~111 km per degree

function setup(opts = {}) {
  const { radiusM = 500, growPerStepM = 0, stepMinutes = 10, ...rest } = opts;
  const room = createRoom({
    hostId: "h",
    hostName: "Host",
    roundMinutes: 60,
    zone: { center: C, radiusM, growPerStepM, stepMinutes },
    pingIntervalMin: 1,
    ...rest,
  });
  addPlayer(room, { id: "r", name: "Runner" });
  addPlayer(room, { id: "s", name: "Seeker" });
  setRole(room, "r", "runner", "h");
  setRole(room, "s", "seeker", "h");
  return room;
}

test("distance is roughly correct", () => {
  assert.ok(Math.abs(distanceM(C, at(0.001)) - 111) < 2);
});

test("the host can pick the runner role", () => {
  const room = createRoom({ hostId: "h", hostName: "H", hostRole: "runner", roundMinutes: 30, zone: { center: C, radiusM: 100 } });
  assert.equal(room.players.h.role, "runner");
});

test("cannot start without a runner", () => {
  const room = createRoom({ hostId: "h", hostName: "H", roundMinutes: 30, zone: { center: C, radiusM: 100 } });
  assert.throws(() => startRound(room, "h", 0), /runner/);
});

test("start is refused without a seeker", () => {
  const room = setup();
  room.players.s.role = "runner";
  room.players.h.role = "runner";
  assert.throws(() => startRound(room, "h", 0), /seeker/);
});

test("the ping interval must be valid", () => {
  assert.throws(
    () => createRoom({ hostId: "h", hostName: "H", roundMinutes: 30, zone: { center: C, radiusM: 100 }, pingIntervalMin: 0 }),
    /ping interval/
  );
});

test("pings sit on a fixed clock after the start", () => {
  const room = setup({ pingIntervalMin: 2 });
  startRound(room, "h", 1000);
  assert.equal(nextPingAt(room, 1000), 1000 + 120000);
  assert.equal(nextPingAt(room, 1000 + 119999), 1000 + 120000);
  assert.equal(nextPingAt(room, 1000 + 120000), 1000 + 240000);
});

test("runner pings are throttled unless forced", () => {
  const room = setup({ pingIntervalMin: 2 });
  startRound(room, "h", 0);
  reportLocation(room, "r", at(0), 10000);
  assert.equal(room.players.r.pingAt, 10000);
  reportLocation(room, "r", at(0.0001), 20000); // too early, ignored
  assert.equal(room.players.r.pingAt, 10000);
  reportLocation(room, "r", at(0.0002), 30000, { forced: true });
  assert.equal(room.players.r.pingAt, 30000);
  assert.equal(room.players.r.pos.lat, at(0.0002).lat);
});

test("tag converts the runner to a seeker and ends the round when nobody hides", () => {
  const room = setup();
  startRound(room, "h", 0);
  tag(room, "s", "r", T);
  assert.equal(room.players.r.role, "seeker");
  assert.equal(room.players.r.status, "ok");
  assert.equal(room.phase, "finished");
  assert.match(room.events.at(-1).text, /Sucher gewinnen/);
});

test("without tagging a tagged runner sits out the round", () => {
  const room = setup({ tagging: false });
  startRound(room, "h", 0);
  tag(room, "s", "r", T);
  assert.equal(room.players.r.role, "runner");
  assert.equal(room.players.r.status, "tagged");
});

test("runner can confirm being tagged manually", () => {
  const room = setup();
  startRound(room, "h", 0);
  confirmTagged(room, "r", T);
  assert.equal(room.players.r.role, "seeker");
});

test("calls are unlimited and allowed during the head start", () => {
  const room = setup();
  startRound(room, "h", 0);
  for (let i = 0; i < 6; i += 1) contact(room, "s", "r", "call", 1);
  for (let i = 0; i < 6; i += 1) contact(room, "s", "r", "facetime", 1);
  assert.equal(room.players.s.calls, 6);
  assert.equal(room.players.s.facetimes, 6);
});

test("max 3 tips", () => {
  const room = setup();
  startRound(room, "h", 0);
  requestTip(room, "s", "r", 0, T + 1);
  requestTip(room, "s", "r", 1, T + 2);
  requestTip(room, "s", "r", 2, T + 3);
  assert.throws(() => requestTip(room, "s", "r", 3, T + 4), /no tips/);
});

test("seekers cannot ask or tag during the 5 minute head start", () => {
  const room = setup();
  startRound(room, "h", 0);
  assert.throws(() => requestTip(room, "s", "r", 0, HIDE_HEAD_START_MS - 1), /still hiding/);
  assert.throws(() => tag(room, "s", "r", HIDE_HEAD_START_MS - 1), /still hiding/);
  requestTip(room, "s", "r", 0, HIDE_HEAD_START_MS);
  assert.equal(room.tips.length, 1);
});

test("advanced tips request a ping of all runners", () => {
  const plain = setup();
  startRound(plain, "h", 0);
  assert.throws(() => requestLocationPing(plain, "s", T), /advanced tips/);

  const room = setup({ advancedTips: true });
  startRound(room, "h", 0);
  requestLocationPing(room, "s", T);
  assert.equal(room.pingRequestAt, T);
  assert.equal(room.pingRequestBy, "s");
});

test("vehicles can be picked during the round when enabled", () => {
  const room = setup({ vehicles: true });
  startRound(room, "h", 0);
  setVehicle(room, "r", VEHICLES[1], T);
  assert.equal(room.players.r.vehicle, VEHICLES[1]);
  setVehicle(room, "r", null, T + 1);
  assert.equal(room.players.r.vehicle, null);
  assert.throws(() => setVehicle(room, "r", "Panzer", T + 2), /unknown vehicle/);
  assert.throws(() => setVehicle(room, "s", VEHICLES[0], T + 3), /only runners/);

  const off = setup();
  startRound(off, "h", 0);
  assert.throws(() => setVehicle(off, "r", VEHICLES[0], T), /vehicles are off/);
});

test("runner answers a tip once, empty answers rejected", () => {
  const room = setup();
  startRound(room, "h", 0);
  requestTip(room, "s", "r", 1, T);
  const tipId = room.tips[0].id;
  assert.throws(() => answerTip(room, "r", tipId, "   ", T + 1), /empty/);
  answerTip(room, "r", tipId, "Hauptstrasse", T + 2);
  assert.equal(room.tips[0].answer, "Hauptstrasse");
  assert.throws(() => answerTip(room, "r", tipId, "nochmal", T + 3), /already/);
});

test("the host can kick players only in the lobby", () => {
  const room = setup();
  addPlayer(room, { id: "x", name: "Extra" });
  assert.throws(() => kickPlayer(room, "s", "x"), /only host/);
  assert.throws(() => kickPlayer(room, "h", "h"), /host cannot be kicked/);
  kickPlayer(room, "h", "x");
  assert.equal(room.players.x, undefined);

  startRound(room, "h", 0);
  assert.throws(() => kickPlayer(room, "h", "r"), /already started/);
});

test("leaving passes the host role on and reports an empty room", () => {
  const room = setup();
  assert.equal(leaveRoom(room, "h"), false);
  assert.equal(room.hostId, "r");
  assert.equal(leaveRoom(room, "r"), false);
  assert.equal(leaveRoom(room, "s"), true);
});

test("random roles keep at least one seeker and one runner", () => {
  const room = setup();
  addPlayer(room, { id: "x", name: "Extra" });
  assert.throws(() => randomizeRoles(room, "s"), /only host/);
  for (let i = 0; i < 20; i += 1) {
    randomizeRoles(room, "h");
    const roles = Object.values(room.players).map((p) => p.role);
    assert.ok(roles.includes("seeker"));
    assert.ok(roles.includes("runner"));
  }
});

test("runner loses after more than 60 s outside zone, not before", () => {
  const room = setup({ radiusM: 100 });
  startRound(room, "h", 0);
  reportLocation(room, "r", at(0.01), 1000, { forced: true }); // ~1.1 km out
  reportLocation(room, "r", at(0.01), 60000, { forced: true });
  assert.equal(room.players.r.status, "ok");
  reportLocation(room, "r", at(0.01), 62000, { forced: true });
  assert.equal(room.players.r.status, "lost");
});

test("returning to zone resets the out-of-zone timer", () => {
  const room = setup({ radiusM: 100 });
  startRound(room, "h", 0);
  reportLocation(room, "r", at(0.01), 1000, { forced: true });
  reportLocation(room, "r", C, 30000, { forced: true });
  reportLocation(room, "r", at(0.01), 40000, { forced: true });
  reportLocation(room, "r", at(0.01), 90000, { forced: true }); // only 50 s since leaving again
  assert.equal(room.players.r.status, "ok");
});

test("growing zone increases radius per step", () => {
  const room = setup({ radiusM: 100, growPerStepM: 50, stepMinutes: 10 });
  startRound(room, "h", 0);
  assert.equal(zoneRadius(room, 0), 100);
  assert.equal(zoneRadius(room, 10 * 60000), 150);
  assert.equal(zoneRadius(room, 25 * 60000), 200);
});

test("round ends at time limit; runners still ok win", () => {
  const room = setup();
  startRound(room, "h", 0);
  checkEnd(room, 59 * 60000);
  assert.equal(room.phase, "running");
  checkEnd(room, 60 * 60000);
  assert.equal(room.phase, "finished");
  assert.match(room.events.at(-1).text, /Verstecker gewinnen: Runner/);
});

test("the host can start another round after the end", () => {
  const room = setup();
  startRound(room, "h", 0);
  assert.throws(() => resetRound(room, "h"), /not finished/);
  checkEnd(room, 60 * 60000);
  resetRound(room, "h");
  assert.equal(room.phase, "lobby");
  assert.equal(room.players.r.status, "ok");
});
