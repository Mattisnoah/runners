import React, { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "./api.js";

const SESSION_KEY = "runners-session";

// Same values as server/game.js: the host decides whether vehicles are allowed.
const VEHICLES = ["Roller", "Fahrrad", "Skateboard", "Longboard", "E-Bike", "E-Roller", "Hoverboard", "Inliner / Rollschuhe"];

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
  // The server clock drives every countdown, so a wrong phone clock does not break the timers.
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    const tick = async () => {
      try {
        const data = await api.getRoom(session.code, session.playerId);
        if (!alive) return;
        // Round to whole seconds: the tiny jitter of every poll must not restart the ping timers.
        setOffset(Math.round((data.now - Date.now()) / 1000) * 1000);
        if (!data.room.players[session.playerId]) {
          // Kicked or removed: forget the room and go back to the start.
          localStorage.removeItem(SESSION_KEY);
          setRoom(null);
          setSession(null);
          setStarted(true);
          setError("Du bist nicht mehr in diesem Raum.");
          return;
        }
        setRoom(data.room);
      } catch (e) {
        if (!alive) return;
        if (e.message === "room not found") {
          localStorage.removeItem(SESSION_KEY);
          setRoom(null);
          setSession(null);
          setStarted(false);
          setError("Der Raum existiert nicht mehr. Bitte neu starten.");
          return;
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

  const leave = useCallback(async () => {
    if (session) await api.leave(session.code, session.playerId).catch(() => {});
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setRoom(null);
    setError("");
    setStarted(false);
  }, [session]);

  if (!session) {
    if (!started) return <Intro onStart={() => setStarted(true)} />;
    return <Start onEnter={enter} onError={setError} error={error} />;
  }

  if (!room) {
    return (
      <main className="wrap">
        <p className="hint">Verbinde mit Raum {session.code} …</p>
        {error && <p className="error">{error}</p>}
        <BottomBar onLeave={leave} />
      </main>
    );
  }

  return (
    <main className="wrap">
      <header className="game-head">
        <h1>Runners</h1>
        <span className="chip">{room.phase === "lobby" ? "Lobby" : room.phase === "running" ? "läuft" : "vorbei"}</span>
      </header>
      <p className="hint">
        Raum-Code: <strong>{session.code}</strong> · {Object.keys(room.players).length} Spieler
      </p>

      {room.phase === "lobby" && <Lobby room={room} me={session.playerId} code={session.code} onError={setError} />}
      {room.phase === "running" && (
        <Game room={room} me={session.playerId} code={session.code} onError={setError} offset={offset} />
      )}
      {room.phase === "finished" && <Finished room={room} me={session.playerId} code={session.code} onError={setError} />}

      {error && <p className="error">{error}</p>}
      <BottomBar onLeave={leave} />
    </main>
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
          <li><strong>Raum anlegen.</strong> Wer den Raum erstellt, legt Rundenlänge, Ping-Takt, Fahrzeuge, Anstecken und die erweiterten Tipps fest und teilt den Code.</li>
          <li><strong>Beitreten.</strong> Alle geben den Code ein. Eine Telefonnummer ist für Anrufe nötig.</li>
          <li><strong>Rollen verteilen.</strong> Der Host bestimmt Sucher und Verstecker – auch seine eigene Rolle – oder lässt die Rollen zufällig verteilen. Spieler können vor dem Start rausgeworfen werden.</li>
          <li><strong>Vorsprung.</strong> Die Verstecker haben fünf Minuten Vorsprung. In dieser Zeit können die Sucher nichts tun.</li>
          <li><strong>Standort-Pings.</strong> Die Verstecker schicken ihren Standort nur im eingestellten Takt. Dazwischen bewegt sich ihr Punkt auf der Karte nicht.</li>
          <li><strong>Anrufe.</strong> Die Sucher können jederzeit anrufen oder FaceTime anfragen – ohne Limit.</li>
          <li><strong>Tipps.</strong> Verstecker beantworten Tipp-Fragen. Mit erweiterten Tipps können Sucher einen sofortigen Standort-Ping aller Verstecker anfordern.</li>
          <li><strong>Anstecken.</strong> Ist Anstecken an, wird jeder getickte Verstecker automatisch selbst zum Sucher.</li>
          <li><strong>Fahrzeuge.</strong> Ist es erlaubt, kann jeder Verstecker jederzeit ein Fahrzeug wählen: Roller, Fahrrad, Skateboard und mehr.</li>
        </ol>
      </section>
    </main>
  );
}

function Start({ onEnter, onError, error }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [hostRole, setHostRole] = useState("seeker");
  const [roundMinutes, setRoundMinutes] = useState(60);
  const [pingIntervalMin, setPingIntervalMin] = useState(3);
  const [vehicles, setVehicles] = useState(false);
  const [tagging, setTagging] = useState(true);
  const [advancedTips, setAdvancedTips] = useState(false);
  const [radiusM, setRadiusM] = useState(300);
  const [growPerStepM, setGrowPerStepM] = useState(0);

  const create = async () => {
    try {
      const pos = await getPosition();
      const data = await api.createRoom({
        name,
        phone,
        hostRole,
        roundMinutes,
        pingIntervalMin,
        vehicles,
        tagging,
        advancedTips,
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
        <h2>Neues Spiel</h2>
        <label>
          Deine Rolle als Host
          <select value={hostRole} onChange={(e) => setHostRole(e.target.value)}>
            <option value="seeker">Sucher</option>
            <option value="runner">Verstecker</option>
          </select>
        </label>
        <label>
          Rundenlänge
          <select value={roundMinutes} onChange={(e) => setRoundMinutes(Number(e.target.value))}>
            <option value={30}>30 Minuten</option>
            <option value={60}>60 Minuten</option>
            <option value={120}>120 Minuten</option>
          </select>
        </label>
        <label>
          Standort-Ping alle
          <select value={pingIntervalMin} onChange={(e) => setPingIntervalMin(Number(e.target.value))}>
            <option value={1}>1 Minute</option>
            <option value={2}>2 Minuten</option>
            <option value={3}>3 Minuten</option>
            <option value={5}>5 Minuten</option>
            <option value={10}>10 Minuten</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={vehicles} onChange={(e) => setVehicles(e.target.checked)} />
          Mit Fahrzeugen spielen
        </label>
        <label className="check">
          <input type="checkbox" checked={tagging} onChange={(e) => setTagging(e.target.checked)} />
          Mit Anstecken (Getickte werden Sucher)
        </label>
        <label className="check">
          <input type="checkbox" checked={advancedTips} onChange={(e) => setAdvancedTips(e.target.checked)} />
          Erweiterte Tipps (Standort-Ping)
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
        <h2>Spiel beitreten</h2>
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
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

export { getPosition };

function BottomBar({ onLeave }) {
  return (
    <div className="bottom-bar">
      <button
        className="danger"
        onClick={() => {
          if (window.confirm("Raum verlassen und zurück zum Anfang?")) onLeave();
        }}
      >
        Raum verlassen
      </button>
    </div>
  );
}

function Lobby({ room, me, code, onError }) {
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
    <>
      <section className="card">
        <h2>Spieler ({players.length})</h2>
        <ul className="players">
          {players.map((p) => (
            <li key={p.id}>
              <div className="player-row">
                <span>
                  {p.name}
                  {p.id === me && " (du)"}
                  {p.id === room.hostId && <span className="hint"> · Host</span>}
                </span>
                <span className={`chip ${p.role}`}>{p.role === "runner" ? "Verstecker" : "Sucher"}</span>
              </div>
              {isHost && (
                <div className="row">
                  <button
                    className="ghost"
                    onClick={() => run(() => api.setRole(code, me, p.id, p.role === "runner" ? "seeker" : "runner"))}
                  >
                    {p.role === "runner" ? "Als Sucher" : "Als Verstecker"}
                  </button>
                  {p.id !== me && (
                    <button className="ghost danger" onClick={() => run(() => api.kick(code, me, p.id))}>
                      Rauskicken
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {isHost && (
          <button className="ghost" onClick={() => run(() => api.randomize(code, me))}>
            Rollen zufällig verteilen
          </button>
        )}
      </section>

      <section className="card">
        <h2>Einstellungen</h2>
        <ul className="facts">
          <li>Runde: {room.roundMinutes} Minuten</li>
          <li>Standort-Ping: alle {room.pingIntervalMin} Minuten</li>
          <li>Fahrzeuge: {room.vehicles ? "erlaubt" : "aus"}</li>
          <li>Anstecken: {room.tagging ? "an – Getickte suchen mit" : "aus"}</li>
          <li>Erweiterte Tipps: {room.advancedTips ? "an" : "aus"}</li>
          <li>Zone: {room.zone.radiusM} m{room.zone.growPerStepM > 0 ? ` (wächst um ${room.zone.growPerStepM} m)` : " (fest)"}</li>
        </ul>
        {isHost ? (
          <button onClick={() => run(() => api.start(code, me))}>Spiel starten</button>
        ) : (
          <p className="hint">Warte, bis der Host startet.</p>
        )}
      </section>
    </>
  );
}

// Game view: ping-based locations, vehicles, tagging, calls and tips.
function currentRadius(room, now) {
  const z = room.zone;
  if (!z.growPerStepM || room.startedAt == null) return z.radiusM;
  const steps = Math.floor(Math.max(0, now - room.startedAt) / (z.stepMinutes * 60 * 1000));
  return z.radiusM + steps * z.growPerStepM;
}

function nextPingIn(room, now) {
  if (room.phase !== "running" || room.startedAt == null) return null;
  const step = room.pingIntervalMin * 60 * 1000;
  const elapsed = Math.max(0, now - room.startedAt);
  return room.startedAt + (Math.floor(elapsed / step) + 1) * step - now;
}

function fmtTime(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ageLabel(ms) {
  if (ms < 45000) return "gerade eben";
  return `vor ${Math.round(ms / 60000)} Min`;
}

function haversineM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
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

function Game({ room, me, code, onError, offset }) {
  const mine = room.players[me];
  const isSeeker = mine.role === "seeker";
  const runners = Object.values(room.players).filter((p) => p.role === "runner");
  const [myPos, setMyPos] = useState(null);
  const [now, setNow] = useState(() => Date.now() + offset);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const lastForce = useRef(0);
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  useEffect(() => {
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(id);
  }, [offset]);

  const sendPing = useCallback(
    async (forced = false) => {
      try {
        const p = await getPosition();
        setMyPos(p);
        await api.location(code, me, p, forced);
      } catch (e) {
        onError(e.message);
      }
    },
    [code, me, onError]
  );

  const pingMs = room.pingIntervalMin * 60 * 1000;

  // Runners send their location only on the ping clock. No live updates.
  // The clock runs on the server timeline, so the countdown and the actual ping match.
  useEffect(() => {
    if (isSeeker || mine.status !== "ok" || room.startedAt == null) return;
    lastForce.current = room.pingRequestAt || 0;
    let alive = true;
    let timer = null;
    const schedule = () => {
      const serverNow = Date.now() + offsetRef.current;
      const elapsed = Math.max(0, serverNow - room.startedAt);
      const next = room.startedAt + (Math.floor(elapsed / pingMs) + 1) * pingMs;
      timer = setTimeout(() => {
        if (!alive) return;
        sendPing(false);
        schedule();
      }, Math.max(0, next - serverNow) + 250);
    };
    schedule();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [isSeeker, mine.status, sendPing, pingMs, room.startedAt, room.pingRequestAt]);

  // Advanced tip: a seeker asked for a ping of all runners, so answer right away.
  useEffect(() => {
    if (isSeeker) return;
    if (!room.pingRequestAt || room.pingRequestAt === lastForce.current) return;
    lastForce.current = room.pingRequestAt;
    sendPing(true);
  }, [isSeeker, room.pingRequestAt, sendPing]);

  // Seekers keep their own position locally (map marker and distances) but never send it.
  useEffect(() => {
    if (!isSeeker) return;
    let alive = true;
    const grab = () =>
      getPosition()
        .then((p) => {
          if (alive) setMyPos(p);
        })
        .catch(() => {});
    grab();
    const id = setInterval(grab, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [isSeeker]);

  const act = async (fn) => {
    try {
      await fn();
    } catch (e) {
      onError(e.message);
    }
  };

  const pingIn = nextPingIn(room, now);
  const endIn = room.endsAt ? Math.max(0, room.endsAt - now) : 0;
  const headStartIn = room.seekersFreeAt ? Math.max(0, room.seekersFreeAt - now) : 0;
  const stepMs = room.zone.stepMinutes * 60 * 1000;
  const zoneGrows = room.zone.growPerStepM > 0 && room.startedAt != null;
  const nextZoneIn = zoneGrows
    ? room.startedAt + (Math.floor(Math.max(0, now - room.startedAt) / stepMs) + 1) * stepMs - now
    : null;

  const mapPoints = isSeeker
    ? runners
        .filter((r) => r.pos)
        .map((r) => ({
          lat: r.pos.lat,
          lng: r.pos.lng,
          label: `${r.name} · ${r.pingAt ? ageLabel(now - r.pingAt) : "ohne Ping"}`,
          color: r.status === "ok" ? "#c53030" : "#6b7280",
        }))
    : [];
  if (myPos) mapPoints.push({ lat: myPos.lat, lng: myPos.lng, label: "Du", color: "#2b6cb0" });

  const dist = (other) => (!myPos || !other.pos ? null : haversineM(myPos, other.pos));

  return (
    <section className="card">
      <h2>
        {isSeeker ? "Sucher" : "Verstecker"} – {mine.name}
      </h2>
      <p>
        Status: {mine.status === "ok" ? "aktiv" : mine.status === "lost" ? "verloren" : "getickt"}
        {!isSeeker && mine.vehicle && <span className="chip">{mine.vehicle}</span>}
      </p>
      {isSeeker && headStartIn > 0 && <p className="hint">Vorsprung der Verstecker: noch {fmtTime(headStartIn)}</p>}

      <div className="timers">
        <div>
          <span>Nächster Ping</span>
          <strong>{pingIn === null ? "–" : fmtTime(pingIn)}</strong>
        </div>
        <div>
          <span>Nächste Zone</span>
          <strong>{zoneGrows ? fmtTime(nextZoneIn) : "fest"}</strong>
        </div>
        <div>
          <span>Rundenende</span>
          <strong>{fmtTime(endIn)}</strong>
        </div>
      </div>

      <MapView center={room.zone.center} radiusM={currentRadius(room, now)} points={mapPoints} />
      <p className="hint">
        {isSeeker
          ? `Karte zeigt die letzten Ping-Standorte (alle ${room.pingIntervalMin} Min).`
          : `Dein Standort wird nur alle ${room.pingIntervalMin} Minuten gesendet.`}
      </p>

      {!isSeeker && mine.status === "ok" && room.vehicles && (
        <section>
          <h3>Fahrzeug</h3>
          <p className="hint">{mine.vehicle ? `Du nutzt: ${mine.vehicle}` : "Du bist zu Fuss unterwegs."}</p>
          <button className="ghost" onClick={() => setVehicleOpen((v) => !v)}>
            Ich nutze ein Fahrzeug
          </button>
          {vehicleOpen && (
            <div className="chips">
              {VEHICLES.map((v) => (
                <button
                  key={v}
                  className={`chip-btn${mine.vehicle === v ? " active" : ""}`}
                  onClick={() => {
                    act(() => api.vehicle(code, me, v));
                    setVehicleOpen(false);
                  }}
                >
                  {v}
                </button>
              ))}
              <button
                className="chip-btn"
                onClick={() => {
                  act(() => api.vehicle(code, me, null));
                  setVehicleOpen(false);
                }}
              >
                Kein Fahrzeug
              </button>
            </div>
          )}
        </section>
      )}

      {!isSeeker && mine.status === "ok" && <TipAnswers room={room} me={me} code={code} act={act} />}

      {!isSeeker && mine.status === "ok" && (
        <button className="danger" onClick={() => act(() => api.confirmTagged(code, me))}>
          Ich wurde getickt
        </button>
      )}

      {isSeeker && (
        <>
          <h3>Verstecker</h3>
          {runners.length === 0 && <p className="hint">Keine Verstecker mehr – die Sucher gewinnen.</p>}
          <ul className="players">
            {runners.map((r) => {
              const d = dist(r);
              return (
                <li key={r.id}>
                  <div className="player-row">
                    <span>{r.name}</span>
                    <span className={`chip ${r.status}`}>
                      {r.status === "ok" ? "aktiv" : r.status === "lost" ? "verloren" : "getickt"}
                    </span>
                  </div>
                  <p className="hint">
                    {r.vehicle ? `Fahrzeug: ${r.vehicle} · ` : ""}
                    Ping: {r.pingAt ? ageLabel(now - r.pingAt) : "noch keiner"}
                    {d !== null && ` · ca. ${d} m entfernt`}
                  </p>
                  <div className="row">
                    <a
                      href={r.phone ? `tel:${r.phone}` : undefined}
                      onClick={() => act(() => api.contact(code, me, r.id, "call"))}
                    >
                      Anrufen
                    </a>
                    <a
                      href={r.phone ? `facetime:${r.phone}` : undefined}
                      onClick={() => act(() => api.contact(code, me, r.id, "facetime"))}
                    >
                      FaceTime
                    </a>
                    {r.status === "ok" && (
                      <button className="ghost" onClick={() => act(() => api.tag(code, me, r.id))}>
                        Getickt
                      </button>
                    )}
                  </div>
                  <TipButtons room={room} me={me} runnerId={r.id} code={code} tipsUsed={mine.tips} act={act} />
                  {room.tips
                    .filter((t) => t.seekerId === me && t.targetId === r.id)
                    .map((t) => (
                      <p key={t.id} className="hint">
                        {TIP_LABELS[t.tipIndex]}: {t.answer || "noch keine Antwort"}
                      </p>
                    ))}
                </li>
              );
            })}
          </ul>

          {room.advancedTips && (
            <section>
              <button className="ghost" onClick={() => setAdvancedOpen((v) => !v)}>
                Erweiterte Tipps
              </button>
              {advancedOpen && (
                <div className="inner">
                  <p className="hint">Wähle einen Zug.</p>
                  <button
                    onClick={() => {
                      act(() => api.locationPing(code, me));
                      setAdvancedOpen(false);
                    }}
                  >
                    Standort-Ping aller Verstecker
                  </button>
                  <button className="ghost" disabled>
                    Zweite Option (kommt später)
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      <h3>Zone</h3>
      <p className="hint">
        Radius: {Math.round(currentRadius(room, now))} m{zoneGrows ? " (wächst)" : " (fest)"}
      </p>

      <h3>Ereignisse</h3>
      <ul className="events">
        {room.events.map((ev, i) => (
          <li key={i}>{ev.text}</li>
        ))}
      </ul>
    </section>
  );
}

function Finished({ room, me, code, onError }) {
  const isHost = room.hostId === me;
  const run = async (fn) => {
    try {
      await fn();
    } catch (e) {
      onError(e.message);
    }
  };
  return (
    <section className="card">
      <h2>Runde vorbei</h2>
      {isHost && <button onClick={() => run(() => api.reset(code, me))}>Noch eine Runde</button>}
      {!isHost && <p className="hint">Der Host kann eine neue Runde starten.</p>}
      <ul className="events">
        {room.events.map((ev, i) => (
          <li key={i}>{ev.text}</li>
        ))}
      </ul>
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
          <button disabled={!(drafts[t.id] || "").trim()} onClick={() => act(() => api.tipAnswer(code, me, t.id, drafts[t.id]))}>
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
          <option key={i} value={i}>
            {l}
          </option>
        ))}
      </select>
      <button disabled={tipsUsed >= 3} onClick={() => act(() => api.tip(code, me, runnerId, choice))}>
        Tipp anfragen ({tipsUsed}/3)
      </button>
    </div>
  );
}
