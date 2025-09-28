import React, { useEffect, useMemo, useState, useRef } from "react";

const SERVER_KEY = "_sim_server_state_v1";
const CHANNEL_NAME = "sim_server_channel_v1";

function createInitialState(rows = 5, cols = 8) {
  const seats = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = `${String.fromCharCode(65 + r)}${c + 1}`;
      seats[id] = { id, status: "available", lockedBy: null, lockExpiresAt: null };
    }
  }
  return { seats, updatedAt: Date.now(), rows, cols };
}

function readServerState() {
  const raw = localStorage.getItem(SERVER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function writeServerState(state) {
  localStorage.setItem(SERVER_KEY, JSON.stringify(state));
}

const SimServer = (function () {
  const bc = new BroadcastChannel(CHANNEL_NAME);

  function ensureInitialized(rows = 5, cols = 8) {
    if (!readServerState()) {
      const init = createInitialState(rows, cols);
      writeServerState(init);
      bc.postMessage({ type: "init", state: init });
    }
  }

  function broadcast(state) {
    state.updatedAt = Date.now();
    writeServerState(state);
    bc.postMessage({ type: "state", state });
  }

  function cleanupExpiredLocks(state) {
    const now = Date.now();
    let changed = false;
    for (const s of Object.values(state.seats)) {
      if (s.status === "locked" && s.lockExpiresAt && s.lockExpiresAt <= now) {
        s.status = "available";
        s.lockedBy = null;
        s.lockExpiresAt = null;
        changed = true;
      }
    }
    return changed;
  }

  function lockSeat(userId, seatId, ttlMs = 30000) {
    const state = readServerState();
    if (!state) return { ok: false, error: "server_not_init" };
    cleanupExpiredLocks(state);
    const seat = state.seats[seatId];
    if (!seat) return { ok: false, error: "seat_not_found" };
    if (seat.status === "available") {
      seat.status = "locked";
      seat.lockedBy = userId;
      seat.lockExpiresAt = Date.now() + ttlMs;
      broadcast(state);
      return { ok: true, seat: { ...seat } };
    }
    return { ok: false, error: "not_available", seat: { ...seat } };
  }

  function confirmSeat(userId, seatId) {
    const state = readServerState();
    if (!state) return { ok: false, error: "server_not_init" };
    cleanupExpiredLocks(state);
    const seat = state.seats[seatId];
    if (!seat) return { ok: false, error: "seat_not_found" };
    if (seat.status === "locked" && seat.lockedBy === userId) {
      seat.status = "booked";
      seat.lockExpiresAt = null;
      broadcast(state);
      return { ok: true, seat: { ...seat } };
    }
    return { ok: false, error: "cannot_confirm", seat: { ...seat } };
  }

  function releaseLock(userId, seatId) {
    const state = readServerState();
    if (!state) return { ok: false, error: "server_not_init" };
    const seat = state.seats[seatId];
    if (!seat) return { ok: false, error: "seat_not_found" };
    if (seat.status === "locked" && seat.lockedBy === userId) {
      seat.status = "available";
      seat.lockedBy = null;
      seat.lockExpiresAt = null;
      broadcast(state);
      return { ok: true };
    }
    return { ok: false, error: "cannot_release" };
  }

  function getState() {
    const state = readServerState();
    if (!state) return null;
    const changed = cleanupExpiredLocks(state);
    if (changed) writeServerState(state);
    return JSON.parse(JSON.stringify(state));
  }

  function subscribe(onMessage) {
    const handler = (ev) => onMessage(ev.data);
    bc.addEventListener("message", handler);
    return () => bc.removeEventListener("message", handler);
  }

  return { ensureInitialized, lockSeat, confirmSeat, releaseLock, getState, subscribe };
})();

export default function ConcurrentTicketBooking({ rows = 6, cols = 8, lockTTL = 30000 }) {
  const userIdRef = useRef(() => `user_${Math.random().toString(36).slice(2, 9)}`);
  const userId = userIdRef.current;

  const [serverState, setServerState] = useState(() => {
    SimServer.ensureInitialized(rows, cols);
    return SimServer.getState();
  });

  useEffect(() => {
    const unsub = SimServer.subscribe((msg) => {
      if (!msg) return;
      if (msg.type === "state" || msg.type === "init") {
        setServerState(msg.state);
      }
    });
    const onFocus = () => setServerState(SimServer.getState());
    window.addEventListener("focus", onFocus);
    return () => {
      unsub();
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const [localLocks, setLocalLocks] = useState({});

  useEffect(() => {
    const iv = setInterval(() => {
      const s = SimServer.getState();
      if (s) setServerState(s);
      setLocalLocks((prev) => {
        const now = Date.now();
        const next = { ...prev };
        let changed = false;
        for (const [seatId, exp] of Object.entries(prev)) {
          if (exp <= now) {
            delete next[seatId];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 800);
    return () => clearInterval(iv);
  }, []);

  const seatList = useMemo(() => Object.values(serverState?.seats || {}), [serverState]);

  function formatRemaining(seat) {
    if (!seat.lockExpiresAt) return null;
    const ms = seat.lockExpiresAt - Date.now();
    if (ms <= 0) return "00:00";
    const s = Math.ceil(ms / 1000);
    const mm = Math.floor(s / 60).toString().padStart(2, "0");
    const ss = (s % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  }

  async function handleLock(seatId) {
    const res = SimServer.lockSeat(userId, seatId, lockTTL);
    if (res.ok) {
      setLocalLocks((l) => ({ ...l, [seatId]: res.seat.lockExpiresAt }));
    } else {
      setServerState(SimServer.getState());
      alert(res.error === "not_available" ? "Seat not available (locked/booked)." : "Failed to lock seat.");
    }
  }

  async function handleConfirm(seatId) {
    const res = SimServer.confirmSeat(userId, seatId);
    if (res.ok) {
      setLocalLocks((l) => {
        const copy = { ...l };
        delete copy[seatId];
        return copy;
      });
    } else {
      setServerState(SimServer.getState());
      alert("Could not confirm. Your lock may have expired or someone else booked it.");
    }
  }

  async function handleRelease(seatId) {
    const res = SimServer.releaseLock(userId, seatId);
    if (res.ok) {
      setLocalLocks((l) => {
        const copy = { ...l };
        delete copy[seatId];
        return copy;
      });
    } else {
      setServerState(SimServer.getState());
      alert("Could not release lock (maybe you're not the owner or it's already released).");
    }
  }

  const rowsArr = useMemo(() => {
    const r = [];
    const rcount = serverState?.rows || rows;
    const ccount = serverState?.cols || cols;
    for (let i = 0; i < rcount; i++) {
      const rowSeats = [];
      for (let j = 0; j < ccount; j++) {
        const id = `${String.fromCharCode(65 + i)}${j + 1}`;
        rowSeats.push(serverState?.seats?.[id] || { id, status: "available" });
      }
      r.push(rowSeats);
    }
    return r;
  }, [serverState, rows, cols]);

  const styles = {
    container: { padding: 20, fontFamily: "Arial, sans-serif" },
    grid: { display: "grid", gap: 8 },
    seat: {
      width: 64,
      height: 48,
      borderRadius: 6,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      userSelect: "none",
    },
  };

  return (
    <div style={styles.container}>
      <h2>Concurrent Ticket Booking (Simulated Server)</h2>
      <p>
        <strong>Your user id:</strong> {userId} &nbsp;|&nbsp; <strong>Lock TTL:</strong> {Math.round(lockTTL / 1000)}s
      </p>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${serverState?.cols || cols}, 1fr)`, gap: 8 }}>
        {rowsArr.flat().map((seat) => {
          const isLocked = seat.status === "locked";
          const isBooked = seat.status === "booked";
          const iOwnLock = isLocked && seat.lockedBy === userId;

          let bg = "#e0f7fa";
          if (isLocked) bg = iOwnLock ? "#fff3e0" : "#ffe0e0";
          if (isBooked) bg = "#c8e6c9";

          return (
            <div key={seat.id} style={{ ...styles.seat, background: bg, border: "1px solid #ccc" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 700 }}>{seat.id}</div>
                <div style={{ fontSize: 12 }}>
                  {seat.status === "available" && <span>Available</span>}
                  {isLocked && (
                    <div>
                      <div style={{ fontSize: 11 }}>{iOwnLock ? "Your lock" : `Locked by ${seat.lockedBy?.slice(0,6)}`}</div>
                      <div style={{ fontSize: 11 }}>{formatRemaining(seat) || "--:--"}</div>
                    </div>
                  )}
                  {isBooked && <div style={{ fontSize: 11 }}>Booked</div>}
                </div>
                <div style={{ marginTop: 6 }}>
                  {seat.status === "available" && (
                    <button onClick={() => handleLock(seat.id)}>Lock</button>
                  )}
                  {isLocked && iOwnLock && (
                    <>
                      <button onClick={() => handleConfirm(seat.id)} style={{ marginRight: 6 }}>Confirm</button>
                      <button onClick={() => handleRelease(seat.id)}>Release</button>
                    </>
                  )}
                  {isLocked && !iOwnLock && <button disabled>Locked</button>}
                  {isBooked && <button disabled>Booked</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
