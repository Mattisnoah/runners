async function call(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

export const api = {
  createRoom: (body) => call("POST", "/rooms", body),
  getRoom: (code, playerId) => call("GET", `/rooms/${code}?playerId=${encodeURIComponent(playerId || "")}`),
  reset: (code, playerId) => call("POST", `/rooms/${code}/reset`, { playerId }),
  join: (code, name, phone) => call("POST", `/rooms/${code}/join`, { name, phone }),
  start: (code, playerId) => call("POST", `/rooms/${code}/start`, { playerId }),
  setRole: (code, playerId, targetId, role) => call("POST", `/rooms/${code}/role`, { playerId, targetId, role }),
  randomize: (code, playerId) => call("POST", `/rooms/${code}/randomize`, { playerId }),
  kick: (code, playerId, targetId) => call("POST", `/rooms/${code}/kick`, { playerId, targetId }),
  leave: (code, playerId) => call("POST", `/rooms/${code}/leave`, { playerId }),
  location: (code, playerId, pos, forced = false) =>
    call("POST", `/rooms/${code}/location`, { playerId, ...pos, forced: Boolean(forced) }),
  locationPing: (code, playerId) => call("POST", `/rooms/${code}/location-ping`, { playerId }),
  vehicle: (code, playerId, vehicle) => call("POST", `/rooms/${code}/vehicle`, { playerId, vehicle }),
  tag: (code, playerId, targetId) => call("POST", `/rooms/${code}/tag`, { playerId, targetId }),
  confirmTagged: (code, playerId) => call("POST", `/rooms/${code}/confirm-tagged`, { playerId }),
  contact: (code, playerId, targetId, kind) => call("POST", `/rooms/${code}/contact`, { playerId, targetId, kind }),
  tip: (code, playerId, targetId, tipIndex) => call("POST", `/rooms/${code}/tip`, { playerId, targetId, tipIndex }),
  tipAnswer: (code, playerId, tipId, answer) => call("POST", `/rooms/${code}/tip-answer`, { playerId, tipId, answer }),
};
