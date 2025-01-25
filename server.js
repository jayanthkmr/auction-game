/**
 * server.js
 * Run with: node server.js
 */

const path = require("path");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

//////////////////////////////////
// Basic Setup
//////////////////////////////////
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ 
  server,
  clientTracking: true,
  // Handle Heroku's proxy
  perMessageDeflate: {
    zlibDeflateOptions: {
      chunkSize: 1024,
      memLevel: 7,
      level: 3
    },
    zlibInflateOptions: {
      chunkSize: 10 * 1024
    },
    clientNoContextTakeover: true,
    serverNoContextTakeover: true,
    serverMaxWindowBits: 10,
    concurrencyLimit: 10,
    threshold: 1024
  }
});

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

//////////////////////////////////
// In-Memory Game State
//////////////////////////////////
const START_MONEY = 100;
const MAX_TURNS = 5;

let gamePasscode = null;   // first player's passcode sets this
let gameOver = false;
let turnNumber = 1;
let scotchPosition = 5;
let drawAdvantage = 1;
let turnHistory = [];
let showBidsMode = false;

const players = {}; // up to 2
// players[playerName] = { passcode, ws, money, hasSubmitted, lastBid, name }

const audience = []; // watchers

function initGame() {
  console.log("Initializing game state...");
  gamePasscode = null;
  gameOver = false;
  turnNumber = 1;
  scotchPosition = 5;
  drawAdvantage = 1;
  turnHistory = [];
  // Clear players
  for (const p in players) delete players[p];
  // Clear audience
  audience.length = 0;
}
initGame();

//////////////////////////////////
// Helper Functions
//////////////////////////////////
function sendMessage(ws, msgObj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msgObj));
  }
}

function broadcastAll(msgObj) {
  Object.values(players).forEach((pl) => {
    sendMessage(pl.ws, msgObj);
  });
  audience.forEach((a) => {
    sendMessage(a.ws, msgObj);
  });
}

function broadcastBidStatus() {
  const names = Object.keys(players);
  if (names.length < 2) return;
  const p1 = players[names[0]];
  const p2 = players[names[1]];

  broadcastAll({
    type: "BID_STATUS",
    p1Name: p1.name,
    p1Submitted: p1.hasSubmitted,
    p2Name: p2.name,
    p2Submitted: p2.hasSubmitted,
  });
}

function resolveTurn() {
  const playerArray = Object.values(players);
  const p1 = playerArray[0];
  const p2 = playerArray[1];

  // Record old position
  const oldPosition = scotchPosition;
  
  // Determine winner
  let winner;
  let tieUsed = false;
  
  if (p1.lastBid === p2.lastBid) {
    winner = drawAdvantage;
    tieUsed = true;
    // Switch advantage for next tie
    drawAdvantage = drawAdvantage === 1 ? 2 : 1;
  } else {
    winner = p1.lastBid > p2.lastBid ? 1 : 2;
  }

  // Move bottle
  const moveDirection = winner === 1 ? -1 : 1;
  scotchPosition = Math.max(0, Math.min(10, scotchPosition + moveDirection));

  // Only deduct bid from the winning player (corrected logic)
  if (winner === 1) {
    // Player 1 wins, player 1 loses their bid
    p1.money -= p1.lastBid;
  } else {
    // Player 2 wins, player 2 loses their bid
    p2.money -= p2.lastBid;
  }

  // Record turn history
  turnHistory.push({
    turnNumber,
    p1Name: p1.name,
    p2Name: p2.name,
    p1Bid: p1.lastBid,
    p2Bid: p2.lastBid,
    p1MoneyBefore: p1.money + (winner === 1 ? p1.lastBid : 0),
    p2MoneyBefore: p2.money + (winner === 2 ? p2.lastBid : 0),
    p1MoneyAfter: p1.money,
    p2MoneyAfter: p2.money,
    winner,
    tieUsed,
    oldPosition,
    newPosition: scotchPosition
  });

  // Check game over conditions
  gameOver = scotchPosition === 0 || scotchPosition === 10 || turnNumber >= MAX_TURNS;

  // Broadcast turn resolution with winner info
  broadcastAll({
    type: "TURN_RESOLVED",
    oldPosition,
    scotchPosition,
    gameOver,
    turnNumber,
    maxTurns: MAX_TURNS,
    winner,  // Added winner info
    p1Bid: p1.lastBid,
    p2Bid: p2.lastBid
  });

  // Send private updates
  playerArray.forEach(player => {
    sendMessage(player.ws, {
      type: "PLAYER_UPDATE",
      money: player.money,
      lastBid: player.lastBid,
      isWinner: (player === p1 && winner === 1) || (player === p2 && winner === 2)
    });
  });

  if (gameOver) {
    broadcastAll({
      type: "GAME_OVER",
      turnHistory
    });
    // Reset game after short delay
    setTimeout(initGame, 5000);
  } else {
    // Reset for next turn
    turnNumber++;
    p1.hasSubmitted = false;
    p2.hasSubmitted = false;
    p1.lastBid = 0;
    p2.lastBid = 0;
    broadcastBidStatus();
  }
}

//////////////////////////////////
// WebSocket Handling
//////////////////////////////////
wss.on("connection", (ws) => {
  console.log("New WebSocket connection established.");

  ws.on("message", (rawMsg) => {
    let data;
    try {
      data = JSON.parse(rawMsg);
    } catch (err) {
      console.log("Invalid JSON from client:", rawMsg);
      return;
    }

    switch (data.type) {
      // Player login
      case "LOGIN": {
        const { playerName, passcode, showBids } = data;
        console.log(`LOGIN attempt => Name: "${playerName}", Pass: "${passcode}"`);
        if (!playerName || !passcode) {
          console.log("LOGIN_ERROR: Name/passcode missing.");
          return sendMessage(ws, {
            type: "LOGIN_ERROR",
            message: "Name and passcode required.",
          });
        }

        // If no passcode set yet, the first player sets it
        if (!gamePasscode) {
          gamePasscode = passcode;
          console.log(`Set gamePasscode to "${passcode}".`);
        } else {
          // Must match
          if (passcode !== gamePasscode) {
            console.log("LOGIN_ERROR: Passcode mismatch.");
            return sendMessage(ws, {
              type: "LOGIN_ERROR",
              message: "Passcode does not match the existing game.",
            });
          }
        }

        // Name already used with a different passcode?
        if (players[playerName] && players[playerName].passcode !== passcode) {
          console.log("LOGIN_ERROR: Name used with different passcode.");
          return sendMessage(ws, {
            type: "LOGIN_ERROR",
            message: "That name is used with a different passcode.",
          });
        }

        // If we already have 2 players with distinct names
        if (Object.keys(players).length >= 2 && !players[playerName]) {
          console.log("LOGIN_ERROR: 2 players already in the game.");
          return sendMessage(ws, {
            type: "LOGIN_ERROR",
            message: "Game is full (2 players max).",
          });
        }

        // Only let first player set the show bids mode
        if (Object.keys(players).length === 0) {
          showBidsMode = showBids;
        }

        // Register or update
        if (!players[playerName]) {
          players[playerName] = {
            passcode,
            ws,
            money: START_MONEY,
            hasSubmitted: false,
            lastBid: 0,
            name: playerName,
          };
          console.log(`New player "${playerName}" joined with passcode "${passcode}". Starting money: ${START_MONEY}`);
        } else {
          players[playerName].ws = ws;
          console.log(`Player "${playerName}" reconnected. Current money: ${players[playerName].money}`);
        }

        // Send success with show bids mode
        sendMessage(ws, {
          type: "LOGIN_SUCCESS",
          playerName,
          money: players[playerName].money,
          showBidsMode,
          isFirstPlayer: Object.keys(players).length === 1
        });
        
        // If two players are connected, broadcast bid status
        if (Object.keys(players).length === 2) {
          broadcastBidStatus();
        }
        break;
      }

      // Audience
      case "AUDIENCE_JOIN": {
        console.log("Audience member joined.");
        audience.push({ ws });
        sendMessage(ws, { type: "AUDIENCE_OK" });
        // You might also send the current game state
        sendMessage(ws, {
          type: "GAME_STATE",
          scotchPosition,
          turnNumber,
          maxTurns: MAX_TURNS,
          gameOver,
        });
        break;
      }

      // Submit bid
      case "SUBMIT_BID": {
        const { playerName, bid } = data;
        if (!players[playerName]) {
          return;
        }

        // Validate bid
        const player = players[playerName];
        if (bid < 0 || bid > player.money) {
          return sendMessage(player.ws, {
            type: "BID_ERROR",
            message: "Invalid bid amount"
          });
        }

        // Record the bid
        player.lastBid = bid;
        player.hasSubmitted = true;

        // Send confirmation to the player
        sendMessage(player.ws, {
          type: "PLAYER_UPDATE",
          money: player.money,
          lastBid: bid
        });

        // Broadcast bid status
        broadcastBidStatus();

        // Check if both players have submitted
        const playerArray = Object.values(players);
        if (playerArray.length === 2 && playerArray.every(p => p.hasSubmitted)) {
          resolveTurn();
        }
        break;
      }

      default:
        // Possibly handle SUBMIT_BID or other messages
        console.log("Received message of type:", data.type);
        break;
    }
  });

  // On disconnect
  ws.on("close", () => {
    console.log("WebSocket closed.");
    // Identify if it was a player or audience
    let disconnectedPlayerName = null;
    for (const [pName, pObj] of Object.entries(players)) {
      if (pObj.ws === ws) {
        disconnectedPlayerName = pName;
        break;
      }
    }
    if (disconnectedPlayerName) {
      console.log(`Player "${disconnectedPlayerName}" disconnected.`);
      // End game or reassign logic, etc. (Your choice.)
    } else {
      // Might be an audience
      const idx = audience.findIndex((a) => a.ws === ws);
      if (idx >= 0) {
        audience.splice(idx, 1);
        console.log("Removed one audience from the list.");
      }
    }
  });
});
