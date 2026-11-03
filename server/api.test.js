import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "./index.js";

const C = { lat: 52.52, lng: 13.405 };
const T0 = 1_000_000;
const HEAD_START = 5 * 60 * 1000;

function createRoom(extra = {}) {
  const [, create] = handle(
    "POST",
    "/api/rooms",
    {
      name: "Anna",
      roundMinutes: 30,
      pingIntervalMin: 2,
      zone: { center: C, radiusM: 300 },
      ...extra,
    },
    T0
  );
  return create;
}

test("runner view hides seeker positions, seeker view keeps them", () => {
  const { code, playerId: host } = createRoom();
  const [, join] = handle("POST", `/api/rooms/${code}/join`, { name: "Ben" }, T0);
  const runner = join.playerId;
  handle("POST", `/api/rooms/${code}/role`, { playerId: host, targetId: runner, role: "runner" }, T0);
  handle("POST", `/api/rooms/${code}/location`, { playerId: host, lat: C.lat, lng: C.lng }, T0);
  handle("POST", `/api/rooms/${code}/location`, { playerId: runner, lat: C.lat, lng: C.lng }, T0);

  const [, asRunner] = handle("GET", `/api/rooms/${code}?playerId=${runner}`, undefined, T0);
  assert.equal(asRunner.room.players[host].pos, undefined);
  assert.ok(asRunner.room.players[runner].pos);
  assert.equal(typeof asRunner.now, "number");

  const [, asHost] = handle("GET", `/api/rooms/${code}?playerId=${host}`, undefined, T0);
  assert.ok(asHost.room.players[runner].pos);
});

test("lobby routes: random roles, kick and leave", () => {
  const { code, playerId: host } = createRoom();
  const [, join] = handle("POST", `/api/rooms/${code}/join`, { name: "Ben" }, T0);
  const [, join2] = handle("POST", `/api/rooms/${code}/join`, { name: "Cem" }, T0);

  assert.equal(handle("POST", `/api/rooms/${code}/randomize`, { playerId: host }, T0)[0], 200);
  const [, afterRandom] = handle("GET", `/api/rooms/${code}?playerId=${host}`, undefined, T0);
  const roles = Object.values(afterRandom.room.players).map((p) => p.role);
  assert.ok(roles.includes("seeker"));
  assert.ok(roles.includes("runner"));

  assert.equal(handle("POST", `/api/rooms/${code}/kick`, { playerId: host, targetId: join2.playerId }, T0)[0], 200);
  const [, afterKick] = handle("GET", `/api/rooms/${code}?playerId=${host}`, undefined, T0);
  assert.equal(afterKick.room.players[join2.playerId], undefined);

  assert.equal(handle("POST", `/api/rooms/${code}/leave`, { playerId: join.playerId }, T0)[0], 200);
  const [, afterLeave] = handle("GET", `/api/rooms/${code}?playerId=${host}`, undefined, T0);
  assert.equal(afterLeave.room.players[join.playerId], undefined);
});

test("full round over the API", () => {
  const { code, playerId: host } = createRoom({ vehicles: true, advancedTips: true, tagging: true });
  const [, join] = handle("POST", `/api/rooms/${code}/join`, { name: "Ben" }, T0);
  const runner = join.playerId;

  assert.equal(handle("POST", `/api/rooms/${code}/role`, { playerId: host, targetId: runner, role: "runner" }, T0)[0], 200);
  assert.equal(handle("POST", `/api/rooms/${code}/start`, { playerId: host }, T0)[0], 200);
  assert.equal(handle("POST", `/api/rooms/${code}/start`, { playerId: runner }, T0)[0], 400);

  // Calling has no limits and works right away, even during the head start.
  handle("POST", `/api/rooms/${code}/location`, { playerId: runner, lat: C.lat, lng: C.lng }, T0);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(handle("POST", `/api/rooms/${code}/contact`, { playerId: host, targetId: runner, kind: "call" }, T0)[0], 200);
  }
  // Seekers are still blocked from tipping and tagging during the head start.
  assert.equal(handle("POST", `/api/rooms/${code}/tip`, { playerId: host, targetId: runner, tipIndex: 1 }, T0)[0], 400);

  const afterHeadStart = T0 + HEAD_START;
  assert.equal(
    handle("POST", `/api/rooms/${code}/tip`, { playerId: host, targetId: runner, tipIndex: 1 }, afterHeadStart)[0],
    200
  );
  const [, tipState] = handle("GET", `/api/rooms/${code}?playerId=${host}`, undefined, afterHeadStart);
  const tipId = tipState.room.tips[0].id;
  assert.equal(
    handle("POST", `/api/rooms/${code}/tip-answer`, { playerId: runner, tipId, answer: "Am Park" }, afterHeadStart)[0],
    200
  );

  // The advanced tip asks every runner for a ping.
  assert.equal(handle("POST", `/api/rooms/${code}/location-ping`, { playerId: host }, afterHeadStart)[0], 200);
  // Vehicles are allowed for runners.
  assert.equal(
    handle("POST", `/api/rooms/${code}/vehicle`, { playerId: runner, vehicle: "Fahrrad" }, afterHeadStart)[0],
    200
  );

  const [sGet, room] = handle("GET", `/api/rooms/${code}?playerId=${host}`, undefined, afterHeadStart + 1000);
  assert.equal(sGet, 200);
  assert.equal(room.room.phase, "running");
  assert.equal(room.room.players[host].calls, 4);
  assert.equal(room.room.players[host].tips, 1);
  assert.equal(room.room.players[runner].vehicle, "Fahrrad");
  assert.ok(room.room.pingRequestAt);
  assert.equal(room.room.tips[0].answer, "Am Park");
  assert.equal(room.room.outOfZoneSince, undefined);

  // After the round length the room is finished and the runner wins.
  const [, after] = handle("GET", `/api/rooms/${code}`, undefined, T0 + 30 * 60 * 1000);
  assert.equal(after.room.phase, "finished");
});

test("tagging converts the runner into a seeker and ends the round", () => {
  const { code, playerId: host } = createRoom({ tagging: true });
  const [, join] = handle("POST", `/api/rooms/${code}/join`, { name: "Ben" }, T0);
  const runner = join.playerId;
  handle("POST", `/api/rooms/${code}/role`, { playerId: host, targetId: runner, role: "runner" }, T0);
  handle("POST", `/api/rooms/${code}/start`, { playerId: host }, T0);

  assert.equal(
    handle("POST", `/api/rooms/${code}/tag`, { playerId: host, targetId: runner }, T0 + HEAD_START)[0],
    200
  );
  const [, state] = handle("GET", `/api/rooms/${code}?playerId=${host}`, undefined, T0 + HEAD_START);
  assert.equal(state.room.players[runner].role, "seeker");
  assert.equal(state.room.phase, "finished");
});

test("unknown room and action return errors", () => {
  assert.equal(handle("GET", "/api/rooms/NOPE", {}, T0)[0], 404);
  const { code } = createRoom();
  assert.equal(handle("POST", `/api/rooms/${code}/whatever`, {}, T0)[0], 404);
});

test("invalid round length is rejected", () => {
  assert.equal(handle("POST", "/api/rooms", { name: "A", roundMinutes: 45, zone: { center: C, radiusM: 100 } }, T0)[0], 400);
  assert.equal(
    handle("POST", "/api/rooms", { name: "A", roundMinutes: 30, pingIntervalMin: 0, zone: { center: C, radiusM: 100 } }, T0)[0],
    400
  );
});
