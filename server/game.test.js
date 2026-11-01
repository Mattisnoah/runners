import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoom, addPlayer, setRole, startRound, resetRound, reportLocation, tag, confirmTagged, contact, requestTip, answerTip, checkEnd, zoneRadius, distanceM, HIDE_HEAD_START_MS } from "./game.js";

const T = HIDE_HEAD_START_MS + 1000; // a time after the hiders' head start

const C = { lat: 52.52, lng: 13.405 };
const at = (dLat) => ({ lat: C.lat + dLat, lng: C.lng }); // ~111 km per degree

function setup(opts = {}) {
  const room = createRoom({ hostId: "h", hostName: "Host", roundMinutes: 60, tagMode: 5, zone: { center: C, radiusM: 500, ...opts } });
  addPlayer(room, { id: "r", name: "Runner" });
  addPlayer(room, { id: "s", name: "Seeker" });
  setRole(room, "r", "runner", "h");
  return room;
}

test("distance is roughly correct", () => {
  assert.ok(Math.abs(distanceM(C, at(0.001)) - 111) < 2);
});

test("cannot start without a runner", () => {
  const room = createRoom({ hostId: "h", hostName: "H", roundMinutes: 30, tagMode: 1, zone: { center: C, radiusM: 100 } });
  assert.throws(() => startRound(room, "h", 0), /runner/);
});

test("tag only within range and only seeker -> runner", () => {
  const room = setup();
  startRound(room, "h", 0);
  reportLocation(room, "r", at(0.0001), 1000); // ~11 m
  reportLocation(room, "s", at(0), 1000);
  assert.throws(() => tag(room, "s", "r", T), /too far/);
  reportLocation(room, "s", at(0.00008), 1000); // ~2.2 m from runner
  tag(room, "s", "r", T);
  assert.equal(room.players.r.status, "tagged");
});

test("host may be a runner and the round can be reset", () => {
  const room = createRoom({ hostId: "h", hostName: "H", roundMinutes: 30, tagMode: 0, zone: { center: C, radiusM: 100 } });
  setRole(room, "h", "runner", "h");
  addPlayer(room, { id: "s", name: "S" });
  startRound(room, "h", 0);
  assert.throws(() => resetRound(room, "h"), /not finished/);
  room.phase = "finished";
  resetRound(room, "h");
  assert.equal(room.phase, "lobby");
});

test("start is refused without a seeker", () => {
  const room = setup();
  room.players.s.role = "runner";
  room.players.h.role = "runner";
  assert.throws(() => startRound(room, "h", 0), /seeker/);
});

test("runner can confirm being tagged manually", () => {
  const room = setup();
  startRound(room, "h", 0);
  confirmTagged(room, "r", 500);
  assert.equal(room.players.r.status, "tagged");
});

test("calls blocked within 10 m and limited by round length", () => {
  const room = setup();
  startRound(room, "h", 0);
  reportLocation(room, "r", at(0.00005), 1); // ~5.5 m
  reportLocation(room, "s", at(0), 1);
  assert.throws(() => contact(room, "s", "r", "call", T), /too close/);
  reportLocation(room, "s", at(0.001), 1); // ~111 m
  contact(room, "s", "r", "call", T);
  contact(room, "s", "r", "call", T);
  contact(room, "s", "r", "call", T);
  assert.throws(() => contact(room, "s", "r", "call", T), /no calls left/);
  contact(room, "s", "r", "facetime", T);
  contact(room, "s", "r", "facetime", T);
  assert.throws(() => contact(room, "s", "r", "facetime", T), /no facetimes left/);
});

test("max 3 tips", () => {
  const room = setup();
  startRound(room, "h", 0);
  requestTip(room, "s", "r", 0, T + 1);
  requestTip(room, "s", "r", 1, T + 2);
  requestTip(room, "s", "r", 2, T + 3);
  assert.throws(() => requestTip(room, "s", "r", 3, T + 4), /no tips/);
});

test("seekers cannot act during the 5 minute head start", () => {
  const room = setup();
  startRound(room, "h", 0);
  assert.throws(() => requestTip(room, "s", "r", 0, HIDE_HEAD_START_MS - 1), /still hiding/);
  assert.throws(() => contact(room, "s", "r", "call", HIDE_HEAD_START_MS - 1), /still hiding/);
  assert.throws(() => tag(room, "s", "r", HIDE_HEAD_START_MS - 1), /still hiding/);
  requestTip(room, "s", "r", 0, HIDE_HEAD_START_MS);
  assert.equal(room.tips.length, 1);
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

test("runner loses after more than 60 s outside zone, not before", () => {
  const room = setup({ radiusM: 100 });
  startRound(room, "h", 0);
  reportLocation(room, "r", at(0.01), 1000); // ~1.1 km out
  reportLocation(room, "r", at(0.01), 1000 + 59000);
  assert.equal(room.players.r.status, "ok");
  reportLocation(room, "r", at(0.01), 1000 + 61000);
  assert.equal(room.players.r.status, "lost");
});

test("returning to zone resets the out-of-zone timer", () => {
  const room = setup({ radiusM: 100 });
  startRound(room, "h", 0);
  reportLocation(room, "r", at(0.01), 1000);
  reportLocation(room, "r", C, 30000);
  reportLocation(room, "r", at(0.01), 40000);
  reportLocation(room, "r", at(0.01), 90000); // only 50 s since leaving again
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
