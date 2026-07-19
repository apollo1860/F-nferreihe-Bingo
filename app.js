import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getDatabase, ref, set, update, get, onValue, remove
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

// ---------- Firebase ----------
const firebaseConfig = {
  apiKey: "AIzaSyBNsHaUF3OiEkuSmpTSqhxxU8bvveRqD5k",
  authDomain: "fuenferreihe-bingo.firebaseapp.com",
  databaseURL: "https://fuenferreihe-bingo-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "fuenferreihe-bingo",
  storageBucket: "fuenferreihe-bingo.firebasestorage.app",
  messagingSenderId: "146639533393",
  appId: "1:146639533393:web:c31d0e588d1fc45ec14f70"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ---------- Helpers ----------
function shuffledBoard(){
  const nums = Array.from({length:25}, (_,i)=>i+1);
  for(let i=nums.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [nums[i],nums[j]] = [nums[j],nums[i]];
  }
  const board = [];
  for(let r=0;r<5;r++) board.push(nums.slice(r*5,r*5+5));
  return board;
}

// Returns the keys of all completed lines (rows/cols/diagonals) for a board given a called-set
function completedLines(board, calledObj){
  const called = calledObj || {};
  const has = n => !!called[n];
  const lines = [];
  for(let r=0;r<5;r++){ if(board[r].every(has)) lines.push("r"+r); }
  for(let c=0;c<5;c++){
    let ok=true;
    for(let r=0;r<5;r++){ if(!has(board[r][c])){ ok=false; break; } }
    if(ok) lines.push("c"+c);
  }
  let d1=true, d2=true;
  for(let i=0;i<5;i++){
    if(!has(board[i][i])) d1=false;
    if(!has(board[i][4-i])) d2=false;
  }
  if(d1) lines.push("d1");
  if(d2) lines.push("d2");
  return lines;
}

function makeCode(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for(let i=0;i<4;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

function makeId(){
  return "p-" + Math.random().toString(36).slice(2,10) + Date.now().toString(36);
}

function el(id){ return document.getElementById(id); }
function show(id){ el(id).classList.remove("hidden"); }
function hide(id){ el(id).classList.add("hidden"); }
function escapeHtml(s){
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ---------- State ----------
const state = {
  isHost:false,
  myId:null,
  myName:"",
  roomCode:null,
  room:null,
  lastScores:null,   // for detecting new bingos client-side (toast)
  toastTimer:null
};

function roomRef(path){
  return ref(db, `rooms/${state.roomCode}` + (path ? `/${path}` : ""));
}

// ---------- Start screen ----------
el("btnCreate").addEventListener("click", async ()=>{
  const name = el("nameInput").value.trim();
  if(!name){ el("startError").textContent = "Bitte gib deinen Namen ein."; return; }
  el("startError").textContent = "";

  state.isHost = true;
  state.myName = name;
  state.myId = makeId();
  const code = makeCode();
  state.roomCode = code;

  await set(roomRef(), {
    hostId: state.myId,
    status: "lobby",
    players: { [state.myId]: { name, score:0 } },
    boards: {},
    called: {},
    currentNumber: null,
    calledCount: 0,
    roundKey: 0,
    scoredLines: {},
    turnOrder: [],
    turnIndex: 0
  });

  hide("screen-start");
  show("screen-lobby");
  el("lobbyCode").textContent = code;

  onValue(roomRef(), snap => onRoomUpdate(snap.val()));
});

el("btnJoin").addEventListener("click", async ()=>{
  const name = el("nameInput").value.trim();
  const code = el("codeInput").value.trim().toUpperCase();
  if(!name){ el("startError").textContent = "Bitte gib deinen Namen ein."; return; }
  if(!code || code.length<4){ el("startError").textContent = "Bitte gib einen 4-stelligen Code ein."; return; }
  el("startError").textContent = "";

  state.isHost = false;
  state.myName = name;
  state.myId = makeId();
  state.roomCode = code;

  const existing = await get(roomRef());
  if(!existing.exists()){
    el("startError").textContent = "Raum nicht gefunden. Code prüfen.";
    return;
  }

  await update(roomRef(`players/${state.myId}`), { name, score: 0 });

  hide("screen-start");
  show("screen-lobby");
  el("lobbyCodeCard").classList.add("hidden");
  hide("btnStartGame");
  show("lobbyWaitingGuest");
  hide("lobbyWaitingHost");

  onValue(roomRef(), snap => onRoomUpdate(snap.val()));
});

el("btnStartGame").addEventListener("click", async ()=>{
  await beginRound(state.room);
});

el("btnNewRound").addEventListener("click", async ()=>{
  await beginRound(state.room);
});

// Reshuffles boards for all current players, resets called numbers & turn order.
// Scores are NOT touched — they carry over.
async function beginRound(providedRoom){
  const room = providedRoom || state.room;
  const playerIds = Object.keys(room.players || {});
  const boards = {};
  playerIds.forEach(id => { boards[id] = shuffledBoard(); });

  await update(roomRef(), {
    status: "playing",
    boards,
    called: {},
    currentNumber: null,
    calledCount: 0,
    roundKey: (room.roundKey || 0) + 1,
    scoredLines: {},
    turnOrder: playerIds,
    turnIndex: 0
  });
}

async function callNumber(n){
  const room = state.room;
  const called = {...(room.called || {}), [n]: true};
  const scoredLines = room.scoredLines || {};

  const updates = {
    [`called/${n}`]: true,
    currentNumber: n,
    calledCount: (room.calledCount || 0) + 1
  };

  // Check every player's board for newly completed lines (not previously scored)
  Object.entries(room.players || {}).forEach(([id, p])=>{
    const board = room.boards && room.boards[id];
    if(!board) return;
    const lines = completedLines(board, called);
    const already = scoredLines[id] || {};
    const newLines = lines.filter(l => !already[l]);
    if(newLines.length > 0){
      updates[`players/${id}/score`] = (p.score || 0) + newLines.length;
      newLines.forEach(l => { updates[`scoredLines/${id}/${l}`] = true; });
    }
  });

  const allCalled = (room.calledCount || 0) + 1 >= 25;
  if(!allCalled){
    const order = room.turnOrder || [];
    updates.turnIndex = order.length ? ((room.turnIndex || 0) + 1) % order.length : 0;
  }

  await update(roomRef(), updates);

  if(allCalled){
    const fresh = await get(roomRef());
    const freshRoom = fresh.val();
    if(freshRoom) await beginRound(freshRoom);
  }
}

el("btnEndGame").addEventListener("click", async ()=>{
  await update(roomRef(), { status: "gameover" });
});

el("btnBackToStart").addEventListener("click", async ()=>{
  if(state.isHost && state.roomCode){
    try{ await remove(roomRef()); }catch(e){}
  }
  location.reload();
});

// ---------- Central render: reacts to every DB change ----------
function onRoomUpdate(room){
  if(!room) return;
  state.room = room;

  detectNewBingos(room);

  if(state.isHost){
    renderLobbyPlayers();
    show("btnStartGame");
    el("btnStartGame").disabled = Object.keys(room.players||{}).length < 2;
  } else {
    renderLobbyPlayers();
    hide("btnStartGame");
  }

  if(room.status === "lobby"){
    hide("screen-game");
    hide("overlayEnd");
    show("screen-lobby");
    hide("screen-start");
    return;
  }

  if(room.status === "playing"){
    hide("screen-lobby");
    hide("screen-start");
    show("screen-game");
    hide("overlayEnd");

    if(room.currentNumber){
      el("callNumber").textContent = room.currentNumber;
      el("callNumber").className = "call-number";
    } else {
      el("callNumber").textContent = "?";
      el("callNumber").className = "call-number empty";
    }
    el("calledCount").textContent = (room.calledCount || 0) + " von 25 gezogen";
    el("btnEndGame").classList.toggle("hidden", !state.isHost);
    el("btnNewRound").classList.toggle("hidden", !state.isHost);

    const order = room.turnOrder || [];
    const currentTurnId = order.length ? order[(room.turnIndex || 0) % order.length] : null;
    const turnPlayer = currentTurnId && room.players ? room.players[currentTurnId] : null;
    if(turnPlayer){
      el("turnLabel").textContent = currentTurnId === state.myId
        ? "Du bist dran – tippe eine freie Zahl"
        : `${turnPlayer.name} ist dran`;
    }

    renderBoard(room);
    renderScoreboard(room);
  }

  if(room.status === "gameover"){
    showEndOverlay(room);
  } else {
    hide("overlayEnd");
  }
}

// Compares scores against the last known snapshot and shows a toast for anyone who gained points.
function detectNewBingos(room){
  const players = room.players || {};
  if(state.lastScores){
    const newWinners = [];
    Object.entries(players).forEach(([id,p])=>{
      const prev = state.lastScores[id] || 0;
      const diff = (p.score || 0) - prev;
      if(diff > 0) newWinners.push({ name: p.name, count: diff });
    });
    if(newWinners.length > 0) showBingoToast(newWinners);
  }
  state.lastScores = Object.fromEntries(Object.entries(players).map(([id,p])=>[id, p.score || 0]));
}

function showBingoToast(winners){
  const text = winners.map(w => w.count > 1 ? `${w.name} (+${w.count})` : w.name).join(", ");
  const t = el("bingoToast");
  t.textContent = "🎉 Bingo: " + text;
  t.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(()=> t.classList.remove("visible"), 2600);
}

function renderLobbyPlayers(){
  const room = state.room;
  if(!room) return;
  const list = el("lobbyPlayers");
  list.innerHTML = "";
  const players = Object.entries(room.players || {}).map(([id,p])=>({id, ...p}));
  players.forEach(p=>{
    const div = document.createElement("div");
    div.className = "player-chip" + (p.id===state.myId ? " you":"");
    div.innerHTML = `<span>${escapeHtml(p.name)}</span>`;
    list.appendChild(div);
  });
}

function renderBoard(room){
  const boardEl = el("board");
  const board = room.boards && room.boards[state.myId];
  boardEl.innerHTML = "";
  if(!board) return;
  const called = room.called || {};
  const order = room.turnOrder || [];
  const currentTurnId = order.length ? order[(room.turnIndex || 0) % order.length] : null;
  const isMyTurn = currentTurnId === state.myId;

  for(let r=0;r<5;r++){
    for(let c=0;c<5;c++){
      const n = board[r][c];
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.textContent = n;
      const isCalled = !!called[n];
      if(isCalled){
        cell.classList.add("marked");
      } else if(isMyTurn){
        cell.classList.add("callable");
        cell.addEventListener("click", ()=>{ callNumber(n); });
      }
      boardEl.appendChild(cell);
    }
  }
}

function renderScoreboard(room){
  const list = el("gameScores");
  list.innerHTML = "";
  const players = Object.entries(room.players || {}).map(([id,p])=>({id, ...p}));
  players.sort((a,b)=>b.score-a.score).forEach(p=>{
    const div = document.createElement("div");
    div.className = "player-chip" + (p.id===state.myId ? " you":"");
    div.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="score">${p.score}</span>`;
    list.appendChild(div);
  });
}

function showEndOverlay(room){
  const list = el("finalRanking");
  list.innerHTML = "";
  const players = Object.values(room.players || {});
  const sorted = players.slice().sort((a,b)=>b.score-a.score);
  sorted.forEach((p,i)=>{
    const div = document.createElement("div");
    div.className = "rank-item" + (i===0 ? " first":"");
    div.innerHTML = `<span><span class="pos">${i+1}.</span>${escapeHtml(p.name)}</span><span class="score">${p.score}</span>`;
    list.appendChild(div);
  });
  show("overlayEnd");
}
