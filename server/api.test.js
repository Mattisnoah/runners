import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "./index.js";

const C = { lat: 52.52, lng: 13.405 };
const T0 = 1_000_000;

test("runner view hides seeker positions, seeker view keeps them", () => {
  const [, create] = handle("POST", "/api/rooms", { name: "Anna", roundMinutes: 30, tagMode: 5, zone: { center: C, radiusM: 300 } }, T0);
  const code = create.code;
  const host = create.playerId;
  const [, join] = handle("POST", `/api/rooms/${code}/join`, { name: "Ben" }, T0);
  const runner = join.playerId;
  handle("POST", `/api/rooms/${code}/role`, { playerId: host, targetId: runner, role: "runner" }, T0);
  handle("POST", `/api/rooms/${code}/location`, { playerId: host, lat: C.lat, lng: C.lng }, T0);
  handle("POST", `/api/rooms/${code}/location`, { playerId: runner, lat: C.lat, lng: C.lng }, T0);

  const [, asRunner] = handle("GET", `/api/rooms/${code}?playerId=${runner}`, undefined, T0);
  assert.equal(asRunner.room.players[host].pos, undefined);
  assert.ok(asRunner.room.players[runner].pos);

  const [, asHost] = handle("GET", `/api/rooms/${code}?playerId=${host}`, undefined, T0);
  assert.ok(asHost.room.players[runner].pos);
});

test("full round over the API", () => {
  const [s1, create] = handle("POST", "/api/rooms", { name: "Anna", roundMinutes: 30, tagMode: 5, zone: { center: C, radiusM: 300 } }, T0);
  assert.equal(s1, 201);
  const code = create.code;
  const host = create.playerId;

  const [s2, join] = handle("POST", `/api/rooms/${code}/join`, { name: "Ben" }, T0);
  assert.equal(s2, 201);
  const runner = join.playerId;

  assert.equal(handle("POST", `/api/rooms/${code}/role`, { playerId: host, targetId: runner, role: "runner" }, T0)[0], 200);
  assert.equal(handle("POST", `/api/rooms/${code}/start`, { playerId: host }, T0)[0], 200);

  // Non-host cannot start / change roles
  assert.equal(handle("POST", `/api/rooms/${code}/start`, { playerId: runner }, T0)[0], 400);

  // Runner location far from host -> call blocked when close, allowed when far
  handle("POST", `/api/rooms/${code}/location`, { playerId: runner, lat: C.lat, lng: C.lng }, T0);
  handle("POST", `/api/rooms/${code}/location`, { playerId: host, lat: C.lat, lng: C.lng + 0.00008 }, T0); // ~6 m
  const [sClose, eClose] = handle("POST", `/api/rooms/${code}/contact`, { playerId: host, targetId: runner, kind: "call" }, T0);
  assert.equal(sClose, 400);
  assert.match(eClose.error, /too close/);

  handle("POST", `/api/rooms/${code}/location`, { playerId: host, lat: C.lat + 0.001, lng: C.lng }, T0); // ~111 m
  assert.equal(handle("POST", `/api/rooms/${code}/contact`, { playerId: host, targetId: runner, kind: "call" }, T0)[0], 200);

  assert.equal(handle("POST", `/api/rooms/${code}/tip`, { playerId: host, targetId: runner, tipIndex: 1 }, T0)[0], 200);

  // Room state is returned and hides internal timers
  const [sGet, room] = handle("GET", `/api/rooms/${code}`, {}, T0 + 1000);
  assert.equal(sGet, 200);
  assert.equal(room.room.phase, "running");
  assert.equal(room.room.players[host].calls, 1);
  assert.equal(room.room.players[host].tips, 1);
  assert.equal(room.room.outOfZoneSince, undefined);

  // After the round length, the room is finished and the runner wins
  const [, after] = handle("GET", `/api/rooms/${code}`, {}, T0 + 30 * 60 * 1000);
  assert.equal(after.room.phase, "finished");
});

test("unknown room and action return errors", () => {
  assert.equal(handle("GET", "/api/rooms/NOPE", {}, T0)[0], 404);
  const [, c] = handle("POST", "/api/rooms", { name: "A", roundMinutes: 30, tagMode: 1, zone: { center: C, radiusM: 100 } }, T0);
  assert.equal(handle("POST", `/api/rooms/${c.code}/whatever`, {}, T0)[0], 404);
});

test("invalid round length is rejected", () => {
  const [s] = handle("POST", "/api/rooms", { name: "A", roundMinutes: 45, tagMode: 1, zone: { center: C, radiusM: 100 } }, T0);
  assert.equal(s, 400);
});
