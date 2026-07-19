import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getDatabase, ref, set, update, get, onValue, remove, child
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

function hasBingo(board, calledObj){
  const called = calledObj || {};
  const has = n => !!called[n];
  for(let r=0;r<5;r++){ if(board[r].every(has)) return true; }
  for(let c=0;c<5;c++){
    let ok=true;
    for(let r=0;r<5;r++){ if(!has(board[r][c])){ ok=false; break; } }
    if(ok) return true;
  }
  let d1=true, d2=true;
  for(let i=0;i<5;i++){
    if(!has(board[i][i])) d1=false;
    if(!has(board[i][4-i])) d2=false;
  }
  return d1 || d2;
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
  room:null,        // last known snapshot of rooms/{code}
  processedRoundKey:null
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
    roundWinnerName: null,
    claims: {}
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
  await beginRound(true);
});

async function beginRound(isFirst){
  const room = state.room;
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
    roundWinnerName: null,
    claims: {},
    turnOrder: playerIds,
    turnIndex: 0
  });
}

async function callNumber(n){
  const room = state.room;
  const called = {...(room.called || {}), [n]: true};
  const order = room.turnOrder || [];
  const nextIndex = order.length ? ((room.turnIndex || 0) + 1) % order.length : 0;

  const winners = [];
  Object.entries(room.players || {}).forEach(([id, p])=>{
    const board = room.boards && room.boards[id];
    if(board && hasBingo(board, called)) winners.push({id, name:p.name});
  });

  if(winners.length > 0){
    const updates = {
      [`called/${n}`]: true,
      currentNumber: n,
      calledCount: (room.calledCount || 0) + 1,
      status: "roundover",
      roundWinnerName: winners.map(w=>w.name).join(" & ")
    };
    winners.forEach(w=>{
      updates[`players/${w.id}/score`] = (room.players[w.id].score || 0) + 1;
    });
    await update(roomRef(), updates);
  } else {
    await update(roomRef(), {
      [`called/${n}`]: true,
      currentNumber: n,
      calledCount: (room.calledCount || 0) + 1,
      turnIndex: nextIndex
    });
  }
}

el("btnNextRound").addEventListener("click", async ()=>{
  await beginRound(false);
  hide("overlayRound");
});

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
    hide("overlayRound");
    hide("overlayEnd");
    show("screen-lobby");
    hide("screen-start");
    return;
  }

  if(room.status === "playing" || room.status === "roundover"){
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

  if(room.status === "roundover"){
    if(state.processedRoundKey !== room.roundKey){
      state.processedRoundKey = room.roundKey;
      showRoundOverlay(room);
    }
  }

  if(room.status === "gameover"){
    hide("overlayRound");
    showEndOverlay(room);
  }
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

// ---------- Bingo wird direkt in callNumber() geprüft, kein manueller Claim nötig ----------

function showRoundOverlay(room){
  el("roundWinnerName").textContent = room.roundWinnerName || "—";
  const players = Object.values(room.players || {});
  el("roundScoresText").textContent = players
    .slice().sort((a,b)=>b.score-a.score)
    .map(p=>`${p.name}: ${p.score}`).join(" · ");
  show("overlayRound");
  el("btnNextRound").classList.toggle("hidden", !state.isHost);
  el("waitNextRound").classList.toggle("hidden", state.isHost);
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
