const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public")));

/* ═══════════════════════════════════════════
   GAME CONSTANTS
   ═══════════════════════════════════════════ */
const TEAM_SIZES = {
  5: [2,3,2,3,3], 6: [2,3,4,3,4], 7: [2,3,3,4,4],
  8: [3,4,4,5,5], 9: [3,4,4,5,5], 10:[3,4,4,5,5]
};
const FAILS_REQ = {
  5: [1,1,1,1,1], 6: [1,1,1,1,1], 7: [1,1,1,2,1],
  8: [1,1,1,2,1], 9: [1,1,1,2,1], 10:[1,1,1,2,1]
};
const ROLE_COUNTS = {
  5:{g:3,e:2}, 6:{g:4,e:2}, 7:{g:4,e:3},
  8:{g:5,e:3}, 9:{g:6,e:3}, 10:{g:6,e:4}
};
const ROLES = {
  merlin:   {name:"梅林",   side:"good", emoji:"🧙", desc:"可看到除莫德雷德外的所有邪恶玩家"},
  percival: {name:"派西维尔",side:"good", emoji:"🛡️", desc:"可看到梅林和莫甘娜（无法区分）"},
  loyal:    {name:"忠臣",   side:"good", emoji:"⚔️", desc:"正义阵营，无特殊能力"},
  assassin: {name:"刺客",   side:"evil", emoji:"🗡️", desc:"游戏结束时可刺杀梅林"},
  morgana:  {name:"莫甘娜", side:"evil", emoji:"🔮", desc:"在派西维尔眼中伪装为梅林"},
  mordred:  {name:"莫德雷德",side:"evil", emoji:"👑", desc:"对梅林隐藏身份"},
  oberon:   {name:"奥伯伦", side:"evil", emoji:"👤", desc:"邪恶阵营互不可见"},
  minion:   {name:"爪牙",   side:"evil", emoji:"💀", desc:"邪恶阵营，无特殊能力"}
};

function getRoleSet(n) {
  const {g,e} = ROLE_COUNTS[n]; const r = [];
  r.push("merlin"); if(g>=3) r.push("percival"); while(r.length<g) r.push("loyal");
  r.push("assassin"); if(e>=2) r.push("morgana"); if(e>=3) r.push("mordred"); if(e>=4) r.push("oberon");
  while(r.filter(x=>ROLES[x].side==="evil").length<e) r.push("minion");
  return r;
}
function shuffle(a) {
  const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b;
}
function genCode() {
  const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s="";
  for(let i=0;i<4;i++) s+=c[Math.floor(Math.random()*c.length)]; return s;
}

/* ═══════════════════════════════════════════
   ROOMS STATE
   ═══════════════════════════════════════════ */
const rooms = {}; // code → room state

function getKnowledge(myRole, myId, players) {
  switch(myRole) {
    case "merlin":
      return players.filter(p=>ROLES[p.role].side==="evil"&&p.role!=="mordred"&&p.id!==myId)
        .map(p=>({num:p.number,name:p.name,hint:"邪恶"}));
    case "percival":
      return players.filter(p=>p.role==="merlin"||p.role==="morgana")
        .map(p=>({num:p.number,name:p.name,hint:"梅林或莫甘娜"}));
    case "assassin": case "morgana": case "mordred": case "minion":
      return players.filter(p=>ROLES[p.role].side==="evil"&&p.role!=="oberon"&&p.id!==myId)
        .map(p=>({num:p.number,name:p.name,hint:"邪恶同伴"}));
    default: return [];
  }
}

// Send sanitized state to each player (hide other players' roles)
function broadcastRoom(code) {
  const R = rooms[code];
  if (!R) return;
  const inGame = R.phase !== "lobby";

  for (const p of R.players) {
    const sock = io.sockets.sockets.get(p.id);
    if (!sock) continue;
    // Build per-player view
    const view = {
      ...R,
      players: R.players.map(pl => ({
        id: pl.id, name: pl.name, number: pl.number,
        // Only reveal own role (others only in gameOver)
        role: (pl.id===p.id || R.phase==="gameOver") ? pl.role : null
      })),
      // Per-player knowledge
      myId: p.id,
      myRole: inGame ? p.role : null,
      myKnowledge: inGame ? getKnowledge(p.role, p.id, R.players) : [],
      teamVotes: R.teamVoteResults || null,      // Only show after resolved
      missionVoteCount: null,
    };
    // Strip internal data
    delete view._teamVotes;
    delete view._missionVotes;
    delete view.readyPlayers;
    sock.emit("state", view);
  }
}

/* ═══════════════════════════════════════════
   SOCKET HANDLERS
   ═══════════════════════════════════════════ */
io.on("connection", (socket) => {
  console.log("⚡ 连接:", socket.id.slice(0,8));
  let currentRoom = null;

  socket.on("create", ({name}, cb) => {
    if (!name || name.length > 8) return cb({ok:false,msg:"名字无效"});
    const code = genCode();
    rooms[code] = {
      roomCode: code, hostId: socket.id, phase: "lobby",
      players: [{id:socket.id, name, number:1, role:null}],
      currentMission: 0, currentLeader: 1,
      proposedTeam: [], missionResults: [],
      rejectCount: 0, forcedMission: false, voteRound: 0,
      _teamVotes: {}, _missionVotes: {},
      teamVoteResults: null, missionVoteDetail: null,
      winner: null, winReason: "", assassinTarget: null,
      readyPlayers: []
    };
    socket.join(code);
    currentRoom = code;
    console.log(`🏰 房间 ${code} 由 ${name} 创建`);
    cb({ok:true, code});
    broadcastRoom(code);
  });

  socket.on("join", ({code, name}, cb) => {
    code = (code||"").toUpperCase();
    if (!name || name.length > 8) return cb({ok:false,msg:"名字无效"});
    if (!rooms[code]) return cb({ok:false,msg:"房间不存在"});
    const R = rooms[code];
    if (R.phase !== "lobby") return cb({ok:false,msg:"游戏已开始"});
    if (R.players.length >= 10) return cb({ok:false,msg:"房间已满"});
    if (R.players.find(p=>p.id===socket.id)) return cb({ok:false,msg:"已在房间中"});

    R.players.push({id:socket.id, name, number:R.players.length+1, role:null});
    socket.join(code);
    currentRoom = code;
    console.log(`👤 ${name} 加入房间 ${code} (${R.players.length}人)`);
    cb({ok:true});
    broadcastRoom(code);
  });

  socket.on("startGame", () => {
    const R = rooms[currentRoom];
    if (!R || R.hostId !== socket.id || R.phase !== "lobby") return;
    if (R.players.length < 5) return;
    const n = R.players.length;
    const roles = shuffle(getRoleSet(n));
    R.players.forEach((p,i) => p.role = roles[i]);
    R.currentLeader = Math.floor(Math.random() * n) + 1;
    R.phase = "night"; R.currentMission = 0; R.readyPlayers = [];
    console.log(`🎮 房间 ${currentRoom} 开始游戏 (${n}人)`);
    broadcastRoom(currentRoom);
  });

  socket.on("ready", () => {
    const R = rooms[currentRoom];
    if (!R || R.phase !== "night") return;
    if (!R.readyPlayers.includes(socket.id)) R.readyPlayers.push(socket.id);
    if (R.readyPlayers.length >= R.players.length) {
      R.phase = "teamSelect"; R.readyPlayers = [];
      broadcastRoom(currentRoom);
    }
  });

  socket.on("submitTeam", ({team}) => {
    const R = rooms[currentRoom];
    if (!R || R.phase !== "teamSelect") return;
    const leader = R.players.find(p => p.number === R.currentLeader);
    if (!leader || leader.id !== socket.id) return;
    const sz = TEAM_SIZES[R.players.length]?.[R.currentMission] || 2;
    if (!Array.isArray(team) || team.length !== sz) return;

    R.proposedTeam = team;
    if (R.forcedMission) {
      R.phase = "mission"; R._missionVotes = {};
    } else {
      R.phase = "teamVote"; R._teamVotes = {};
    }
    broadcastRoom(currentRoom);
  });

  socket.on("teamVote", ({vote}) => {
    const R = rooms[currentRoom];
    if (!R || R.phase !== "teamVote") return;
    if (typeof vote !== "boolean") return;
    R._teamVotes[socket.id] = vote;

    if (Object.keys(R._teamVotes).length >= R.players.length) {
      const approvals = Object.values(R._teamVotes).filter(v=>v).length;
      const approved = approvals > R.players.length / 2;
      R.teamVoteResults = {...R._teamVotes};
      R._teamVotes = {};

      if (approved) {
        R.phase = "mission"; R.rejectCount = 0; R._missionVotes = {};
      } else {
        R.rejectCount = (R.rejectCount||0) + 1;
        if (R.rejectCount >= 2) {
          R.currentLeader = (R.currentLeader % R.players.length) + 1;
          R.forcedMission = true; R.rejectCount = 0;
        }
        R.phase = "voteResult";
      }
      R.voteRound++;
      broadcastRoom(currentRoom);
    }
  });

  socket.on("continue", () => {
    const R = rooms[currentRoom];
    if (!R || R.hostId !== socket.id) return;
    if (R.phase === "voteResult") {
      R.phase = "teamSelect"; R.proposedTeam = []; R.teamVoteResults = null;
      broadcastRoom(currentRoom);
    }
    if (R.phase === "missionResult") {
      R.missionVoteDetail = null;
      const goodW = (R.missionResults||[]).filter(r=>r).length;
      const evilW = (R.missionResults||[]).filter(r=>!r).length;
      if (goodW >= 3) R.phase = "assassin";
      else if (evilW >= 3) { R.phase = "gameOver"; R.winner = "evil"; R.winReason = "邪恶方成功破坏了三次任务！"; }
      else { R.phase = "teamSelect"; R.proposedTeam = []; }
      broadcastRoom(currentRoom);
    }
  });

  socket.on("missionVote", ({vote}) => {
    const R = rooms[currentRoom];
    if (!R || R.phase !== "mission") return;
    const me = R.players.find(p=>p.id===socket.id);
    if (!me || !R.proposedTeam.includes(me.number)) return;
    if (typeof vote !== "boolean") return;
    // Good players cannot fail
    if (ROLES[me.role].side === "good" && vote === false) return;

    R._missionVotes[socket.id] = vote;
    const teamPids = R.players.filter(p=>R.proposedTeam.includes(p.number)).map(p=>p.id);
    if (Object.keys(R._missionVotes).length >= teamPids.length) {
      const fails = Object.values(R._missionVotes).filter(v=>!v).length;
      const failsNeeded = FAILS_REQ[R.players.length]?.[R.currentMission] || 1;
      const success = fails < failsNeeded;

      R.missionResults.push(success);
      R.missionVoteDetail = {fails, success};
      R._missionVotes = {}; R.forcedMission = false;
      R.phase = "missionResult";

      const evilW = R.missionResults.filter(r=>!r).length;
      if (evilW < 3) {
        R.currentMission++;
        R.currentLeader = (R.currentLeader % R.players.length) + 1;
        R.rejectCount = 0;
      }
      broadcastRoom(currentRoom);
    }
  });

  socket.on("assassinate", ({target}) => {
    const R = rooms[currentRoom];
    if (!R || R.phase !== "assassin") return;
    const me = R.players.find(p=>p.id===socket.id);
    if (!me || me.role !== "assassin") return;
    const tgt = R.players.find(p=>p.number===target);
    if (!tgt) return;

    R.assassinTarget = target;
    if (tgt.role === "merlin") {
      R.winner = "evil"; R.winReason = "刺客成功刺杀了梅林！邪恶方获胜！";
    } else {
      R.winner = "good"; R.winReason = "刺客未能找到梅林！正义方获胜！";
    }
    R.phase = "gameOver";
    broadcastRoom(currentRoom);
  });

  socket.on("restart", () => {
    const R = rooms[currentRoom];
    if (!R || R.hostId !== socket.id) return;
    R.phase = "lobby";
    R.players.forEach(p => p.role = null);
    R.currentMission = 0; R.currentLeader = 1;
    R.proposedTeam = []; R.missionResults = [];
    R.rejectCount = 0; R.forcedMission = false; R.voteRound = 0;
    R._teamVotes = {}; R._missionVotes = {};
    R.teamVoteResults = null; R.missionVoteDetail = null;
    R.winner = null; R.winReason = ""; R.assassinTarget = null;
    R.readyPlayers = [];
    broadcastRoom(currentRoom);
  });

  socket.on("disconnect", () => {
    console.log("❌ 断开:", socket.id.slice(0,8));
    // Don't remove from room — allow reconnect
  });
});

/* ═══════════════════════════════════════════
   CLEANUP: remove stale rooms every 30 min
   ═══════════════════════════════════════════ */
setInterval(() => {
  const now = Date.now();
  for (const code in rooms) {
    const R = rooms[code];
    const anyOnline = R.players.some(p => io.sockets.sockets.has(p.id));
    if (!anyOnline) { delete rooms[code]; console.log(`🗑️ 清理空房间 ${code}`); }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n⚔️  阿瓦隆服务器运行中: http://localhost:${PORT}\n`);
});
