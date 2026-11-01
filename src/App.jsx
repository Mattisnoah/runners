import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    const tick = async () => {
      try {
        const data = await api.getRoom(session.code, session.playerId);
        if (alive) setRoom(data.room);
      } catch (e) {
        if (!alive) return;
        if (e.message === "room not found") {
          // Stale session (server restarted or room gone): forget it and show the intro again.
          localStorage.removeItem(SESSION_KEY);
          setRoom(null);
          setSession(null);
          setStarted(false);
        }
        setError(e.message);
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
    if (!started && !session) return <Intro onStart={() => setStarted(true)} />;
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

function Intro({ onStart }) {
  return (
    <main className="intro">
      <div className="intro-hero">
        <p className="intro-kicker">Ein Versteckspiel mit Karte</p>
        <h1>Runners</h1>
        <p className="intro-lead">Die Verstecker laufen los, die Sucher bekommen einen Vorsprung und jagen sie durch die Stadt.</p>
        <button className="intro-start" onClick={onStart}>Starten</button>
      </div>

      <section className="intro-how">
        <h2>So funktioniert das Spiel</h2>
        <ol>
          <li><strong>Raum anlegen.</strong> Ein Sucher erstellt einen Raum, legt Zone, Rundenlänge und Tipp-Regeln fest und teilt den Code.</li>
          <li><strong>Beitreten.</strong> Die Verstecker geben den Code ein. Eine Telefonnummer ist für Anrufe nötig.</li>
          <li><strong>Rollen festlegen.</strong> Der Host bestimmt, wie viele Sucher und Verstecker es gibt, und startet das Spiel.</li>
          <li><strong>Vorsprung.</strong> Die Verstecker haben fünf Minuten Vorsprung. In dieser Zeit können die Sucher nichts tun.</li>
          <li><strong>Suchen.</strong> Die Sucher sehen die Standorte der Verstecker auf der Karte und können sie anrufen, per FaceTime anfragen oder Tipps schicken.</li>
          <li><strong>Antworten.</strong> Verstecker beantworten die Tipp-Fragen. Die Sucher sehen die Antworten.</li>
          <li><strong>Ticken.</strong> Ein Sucher, der in Reichweite ist, ticked einen Verstecker. Wer getickt wird, scheidet aus.</li>
          <li><strong>Zone.</strong> Die Zone zeigt den Spielbereich auf der Karte. Sie kann mit der Zeit wachsen.</li>
        </ol>
      </section>
    </main>
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
          {isHost && <button onClick={() => run(() => api.reset(code, me))}>Noch eine Runde</button>}
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
function currentRadius(room, now) {
  const z = room.zone;
  if (!z.growPerStepM || room.startedAt == null) return z.radiusM;
  const steps = Math.floor((now - room.startedAt) / (z.stepMinutes * 60 * 1000));
  return z.radiusM + steps * z.growPerStepM;
}

function MapView({ center, radiusM, points }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    const map = L.map(ref.current).setView([center.lat, center.lng], 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    L.circle([center.lat, center.lng], { radius: radiusM, color: "#2b6cb0", weight: 2, fillOpacity: 0.05 }).addTo(layer);
    points.forEach((p) => {
      L.circleMarker([p.lat, p.lng], { radius: 8, color: p.color || "#c53030" }).bindTooltip(p.label).addTo(layer);
    });
  }, [center, radiusM, points]);

  return <div ref={ref} className="map" />;
}

function Game({ room, me, code, onError }) {
  const mine = room.players[me];
  const isSeeker = mine.role === "seeker";
  const runners = Object.values(room.players).filter((p) => p.role === "runner");
  const seekers = Object.values(room.players).filter((p) => p.role === "seeker");
  const [pos, setPos] = useState(null);
  const [acc, setAcc] = useState(null);
  const [lastSent, setLastSent] = useState(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const headStartLeft = room.seekersFreeAt ? Math.max(0, room.seekersFreeAt - now) : 0;
  const reportEvery = isSeeker ? 15000 : 5 * 60 * 1000;
  const nextSendIn = lastSent ? Math.max(0, lastSent + reportEvery - now) : 0;
  const stepMs = room.zone.stepMinutes * 60 * 1000;
  const zoneGrows = room.zone.growPerStepM > 0 && room.startedAt != null;
  const nextZoneIn = zoneGrows ? Math.max(0, room.startedAt + (Math.floor((now - room.startedAt) / stepMs) + 1) * stepMs - now) : 0;
  const endIn = room.endsAt ? Math.max(0, room.endsAt - now) : 0;
  const fmt = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
  const mapPoints = Object.values(room.players)
    .filter((p) => p.pos && p.id !== me)
    .map((p) => ({ lat: p.pos.lat, lng: p.pos.lng, label: p.name, color: p.role === "runner" ? "#c53030" : "#2f855a" }));
  const myPos = room.players[me]?.pos;
  if (myPos) mapPoints.push({ lat: myPos.lat, lng: myPos.lng, label: "Du", color: "#2b6cb0" });

  // Send own position: immediately, then every 5 minutes for runners and every 15 s for seekers.
  useEffect(() => {
    if (!navigator.geolocation) return;
    const send = (p) => {
      const next = { lat: p.coords.latitude, lng: p.coords.longitude };
      setPos(next);
      setAcc(p.coords.accuracy);
      setLastSent(Date.now());
      api.location(code, me, next).catch((e) => onError(e.message));
    };
    const fail = () => onError("Standort-Freigabe nötig");
    // Seekers follow live so distances update; runners only report every 5 minutes.
    const watchId = navigator.geolocation.watchPosition(send, fail, { enableHighAccuracy: true, maximumAge: 0 });
    const every = isSeeker ? 15000 : 5 * 60 * 1000;
    const id = setInterval(() => navigator.geolocation.getCurrentPosition(send, () => {}, { enableHighAccuracy: true, maximumAge: 0 }), every);
    return () => {
      navigator.geolocation.clearWatch(watchId);
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
      {isSeeker && headStartLeft > 0 && <p className="hint">Vorsprung der Verstecker: noch {fmt(headStartLeft)}</p>}
      <div className="timers">
        <div><span>Nächster Standort</span><strong>{fmt(nextSendIn)}</strong></div>
        <div><span>Nächste Zone</span><strong>{zoneGrows ? fmt(nextZoneIn) : "fest"}</strong></div>
        <div><span>Rundenende</span><strong>{fmt(endIn)}</strong></div>
      </div>
      <MapView center={room.zone.center} radiusM={currentRadius(room, now)} points={mapPoints} />
      <p className="hint">Karte zeigt den letzten gemeldeten Standort{acc !== null && ` (Genauigkeit ca. ${Math.round(acc)} m)`}.</p>

      {!isSeeker && mine.status === "ok" && (
        <TipAnswers room={room} me={me} code={code} act={act} />
      )}

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
                  {room.tips.filter((t) => t.seekerId === me && t.targetId === r.id).map((t) => (
                    <p key={t.id} className="hint">
                      {TIP_LABELS[t.tipIndex]}: {t.answer || "noch keine Antwort"}
                    </p>
                  ))}
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

function TipAnswers({ room, me, code, act }) {
  const open = room.tips.filter((t) => t.targetId === me && !t.answer);
  const [drafts, setDrafts] = useState({});
  if (open.length === 0) return null;
  return (
    <section>
      <h3>Fragen der Sucher</h3>
      {open.map((t) => (
        <div key={t.id} className="tip">
          <p>{TIP_LABELS[t.tipIndex]}</p>
          <input
            value={drafts[t.id] || ""}
            maxLength={200}
            onChange={(e) => setDrafts({ ...drafts, [t.id]: e.target.value })}
            placeholder="Deine Antwort"
          />
          <button
            disabled={!(drafts[t.id] || "").trim()}
            onClick={() => act(() => api.tipAnswer(code, me, t.id, drafts[t.id]))}
          >
            Antworten
          </button>
        </div>
      ))}
    </section>
  );
}

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
