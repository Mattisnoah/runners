import React, { useEffect, useState } from "react";
import { api } from "./api.js";

const SESSION_KEY = "runners-session";

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState(loadSession);
  const [room, setRoom] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!session) return;
    let alive = true;
    const tick = async () => {
      try {
        const data = await api.getRoom(session.code);
        if (alive) setRoom(data.room);
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [session]);

  const enter = (code, playerId) => {
    const s = { code, playerId };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setSession(s);
    setError("");
  };

  if (!session || !room) {
    return (
      <Start
        error={error}
        onEnter={enter}
        onError={setError}
      />
    );
  }

  return (
    <Lobby
      room={room}
      me={session.playerId}
      code={session.code}
      onError={setError}
      error={error}
    />
  );
}

function Start({ onEnter, onError, error }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [roundMinutes, setRoundMinutes] = useState(60);
  const [tagMode, setTagMode] = useState(5);
  const [radiusM, setRadiusM] = useState(300);
  const [growPerStepM, setGrowPerStepM] = useState(0);

  const create = async () => {
    try {
      const pos = await getPosition();
      const data = await api.createRoom({
        name,
        phone,
        roundMinutes,
        tagMode,
        zone: { center: pos, radiusM, growPerStepM },
      });
      onEnter(data.code, data.playerId);
    } catch (e) {
      onError(e.message);
    }
  };

  const join = async () => {
    try {
      const data = await api.join(code.trim().toUpperCase(), name, phone);
      onEnter(code.trim().toUpperCase(), data.playerId);
    } catch (e) {
      onError(e.message);
    }
  };

  return (
    <main className="wrap">
      <h1>Runners</h1>
      <input placeholder="Dein Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input type="tel" placeholder="Deine Telefonnummer (für Anrufe)" value={phone} onChange={(e) => setPhone(e.target.value)} />

      <section className="card">
        <h2>Neues Spiel (Sucher)</h2>
        <label>
          Rundenlänge
          <select value={roundMinutes} onChange={(e) => setRoundMinutes(Number(e.target.value))}>
            <option value={30}>30 Min (2 Anrufe, 1 FaceTime)</option>
            <option value={60}>60 Min (3 Anrufe, 2 FaceTime)</option>
            <option value={120}>120 Min (5 Anrufe, 3 FaceTime)</option>
          </select>
        </label>
        <label>
          Tippen ab
          <select value={tagMode} onChange={(e) => setTagMode(Number(e.target.value))}>
            <option value={5}>5 m (automatisch)</option>
            <option value={1}>1 m (automatisch)</option>
            <option value={0}>Manuell (Verstecker drückt selbst)</option>
          </select>
        </label>
        <label>
          Zonen-Radius (m)
          <input type="number" min="50" value={radiusM} onChange={(e) => setRadiusM(Number(e.target.value))} />
        </label>
        <label>
          Zone wächst pro 10 Min um (m, 0 = fest)
          <input type="number" min="0" value={growPerStepM} onChange={(e) => setGrowPerStepM(Number(e.target.value))} />
        </label>
        <button disabled={!name} onClick={create}>Raum erstellen</button>
      </section>

      <section className="card">
        <h2>Spiel beitreten (Verstecker)</h2>
        <input placeholder="Raum-Code" value={code} onChange={(e) => setCode(e.target.value)} />
        <button disabled={!name || !code} onClick={join}>Beitreten</button>
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  );
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("Standort nicht verfügbar"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => reject(new Error("Standort-Freigabe nötig")),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}

export { getPosition };

function Lobby({ room, me, code, error, onError }) {
  const isHost = room.hostId === me;
  const players = Object.values(room.players);

  const run = async (fn) => {
    try {
      await fn();
    } catch (e) {
      onError(e.message);
    }
  };

  return (
    <main className="wrap">
      <h1>Raum {code}</h1>
      <p>Phase: {room.phase === "lobby" ? "Lobby" : room.phase === "running" ? "läuft" : "beendet"}</p>

      {room.phase === "lobby" && (
        <section className="card">
          <h2>Spieler</h2>
          <ul>
            {players.map((p) => (
              <li key={p.id}>
                {p.name} {p.id === me && "(du)"} – {p.role === "runner" ? "Verstecker" : "Sucher"}
                {isHost && p.id !== me && (
                  <button onClick={() => run(() => api.setRole(code, me, p.id, p.role === "runner" ? "seeker" : "runner"))}>
                    Rolle wechseln
                  </button>
                )}
              </li>
            ))}
          </ul>
          {isHost && <button onClick={() => run(() => api.start(code, me))}>Spiel starten</button>}
        </section>
      )}

      {room.phase === "running" && <Game room={room} me={me} code={code} onError={onError} />}

      {room.phase === "finished" && (
        <section className="card">
          <h2>Spiel vorbei</h2>
          <ul>
            {room.events.map((ev, i) => (
              <li key={i}>{ev.text}</li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}

// Game view: location sharing, tagging, calls and tips.
function Game({ room, me, code, onError }) {
  const mine = room.players[me];
  const isSeeker = mine.role === "seeker";
  const runners = Object.values(room.players).filter((p) => p.role === "runner");
  const seekers = Object.values(room.players).filter((p) => p.role === "seeker");
  const [pos, setPos] = useState(null);

  // Send own position: immediately, then every 5 minutes for runners and every 15 s for seekers.
  useEffect(() => {
    if (!navigator.geolocation) return;
    const send = (p) => {
      const next = { lat: p.coords.latitude, lng: p.coords.longitude };
      setPos(next);
      api.location(code, me, next).catch((e) => onError(e.message));
    };
    const fail = () => onError("Standort-Freigabe nötig");
    // Seekers follow live so distances update; runners only report every 5 minutes.
    const watchId = isSeeker ? navigator.geolocation.watchPosition(send, fail, { enableHighAccuracy: true }) : null;
    if (!isSeeker) navigator.geolocation.getCurrentPosition(send, fail, { enableHighAccuracy: true });
    const every = isSeeker ? 15000 : 5 * 60 * 1000;
    const id = setInterval(() => navigator.geolocation.getCurrentPosition(send, () => {}, { enableHighAccuracy: true }), every);
    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      clearInterval(id);
    };
  }, [code, me, isSeeker]);

  const act = async (fn) => {
    try {
      await fn();
    } catch (e) {
      onError(e.message);
    }
  };

  const dist = (other) => {
    if (!pos || !other.pos) return null;
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(other.pos.lat - pos.lat);
    const dLng = toRad(other.pos.lng - pos.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(pos.lat)) * Math.cos(toRad(other.pos.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  };

  return (
    <section className="card">
      <h2>{isSeeker ? "Sucher" : "Verstecker"} – {mine.name}</h2>
      <p>Status: {mine.status === "ok" ? "aktiv" : mine.status === "lost" ? "verloren" : "getickt"}</p>

      {!isSeeker && mine.status === "ok" && (
        <button className="danger" onClick={() => act(() => api.confirmTagged(code, me))}>
          Ich wurde getickt
        </button>
      )}

      {isSeeker && (
        <>
          <h3>Verstecker</h3>
          <ul>
            {runners.map((r) => {
              const d = dist(r);
              const canContact = mine.status === "ok" && r.status === "ok" && d !== null && d >= 10;
              return (
                <li key={r.id}>
                  {r.name}: {r.status} {d !== null && `(${d} m)`}
                  {r.status === "ok" && room.tagMode !== 0 && (
                    <button disabled={d === null || d > room.tagMode} onClick={() => act(() => api.tag(code, me, r.id))}>
                      Getickt
                    </button>
                  )}
                  <a href={r.phone ? `tel:${r.phone}` : undefined} className={canContact && r.phone ? "" : "disabled"} onClick={() => act(() => api.contact(code, me, r.id, "call"))}>Anrufen ({mine.calls}/{room.limits.calls})</a>
                  <a href={r.phone ? `facetime:${r.phone}` : undefined} className={canContact && r.phone ? "" : "disabled"} onClick={() => act(() => api.contact(code, me, r.id, "facetime"))}>FaceTime ({mine.facetimes}/{room.limits.facetimes})</a>
                  <TipButtons room={room} me={me} runnerId={r.id} code={code} tipsUsed={mine.tips} act={act} />
                </li>
              );
            })}
          </ul>
          <p className="hint">Anrufe und FaceTime sind nur ab 10 m Abstand möglich.</p>
        </>
      )}

      <h3>Zone</h3>
      <p>Radius: {room.zone.radiusM} m{room.zone.growPerStepM > 0 && " (wächst)"}</p>

      <h3>Ereignisse</h3>
      <ul>
        {room.events.map((ev, i) => (
          <li key={i}>{ev.text}</li>
        ))}
      </ul>
      {seekers.length === 0 && null}
    </section>
  );
}

const TIP_LABELS = [
  "In welcher Strasse bist du?",
  "Hast du mich gerade gesehen?",
  "In welche Richtung bist du gerade gelaufen?",
  "Bist du versteckt oder stehst du offen?",
];

function TipButtons({ room, me, runnerId, code, tipsUsed, act }) {
  const [choice, setChoice] = useState(0);
  return (
    <div className="tip">
      <select value={choice} onChange={(e) => setChoice(Number(e.target.value))}>
        {TIP_LABELS.map((l, i) => (
          <option key={i} value={i}>{l}</option>
        ))}
      </select>
      <button disabled={tipsUsed >= 3} onClick={() => act(() => api.tip(code, me, runnerId, choice))}>
        Tipp anfragen ({tipsUsed}/3)
      </button>
    </div>
  );
}
