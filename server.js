/**
 * server.js
 * Run with: node server.js
 */

const path = require("path");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const fs = require('fs');
const { AIPlayer, AI_NAMES } = require('./ai_agents');
const Player = require('./public/player.js');

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

// ELO Rating Constants
const K_FACTOR = 32;
const DEFAULT_RATING = 1200;

// Load leaderboard data
let leaderboardData;
try {
  leaderboardData = JSON.parse(fs.readFileSync('leaderboard.json', 'utf8'));
} catch (err) {
  leaderboardData = { players: {} };
  fs.writeFileSync('leaderboard.json', JSON.stringify(leaderboardData, null, 2));
}

const aiPlayers = {};

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
    p1Submitted: p1.player.gameState.hasSubmitted,
    p2Name: p2.name,
    p2Submitted: p2.player.gameState.hasSubmitted,
  });
}

async function handleAIBid(playerName) {
  const player = players[playerName];
  const aiPlayer = aiPlayers[playerName];
  
  if (!player || !aiPlayer || player.player.gameState.hasSubmitted) return;
  
  // Get opponent info
  const playerArray = Object.values(players);
  const opponent = playerArray.find(p => p.name !== playerName);
  if (!opponent) return;
  
  // Prepare game state for AI
  const gameState = {
    myMoney: player.player.gameState.money,
    bottlePosition: scotchPosition,
    turnNumber,
    maxTurns: MAX_TURNS,
    opponentName: opponent.name
  };
  
  try {
    console.log(`Getting AI bid for ${playerName}...`);
    const bid = await aiPlayer.decideBid(gameState);
    console.log(`AI ${playerName} decided to bid: $${bid}`);
    
    // Submit the bid
    player.player.gameState.lastBid = bid;
    player.player.gameState.hasSubmitted = true;
    
    // Broadcast bid status
    broadcastBidStatus();
    
    // Check if both players have submitted
    if (playerArray.every(p => p.player.gameState.hasSubmitted)) {
      resolveTurn();
    }
  } catch (error) {
    console.error(`Error getting AI bid for ${playerName}:`, error);
    // Fallback to a random bid in case of error
    const fallbackBid = Math.floor(Math.random() * (player.player.gameState.money + 1));
    player.player.gameState.lastBid = fallbackBid;
    player.player.gameState.hasSubmitted = true;
    broadcastBidStatus();
    
    if (playerArray.every(p => p.player.gameState.hasSubmitted)) {
      resolveTurn();
    }
  }
}

function resolveTurn() {
  const playerArray = Object.values(players);
  const p1 = playerArray[0].player;
  const p2 = playerArray[1].player;

  // Record old position and money
  const oldPosition = scotchPosition;
  const p1MoneyBefore = p1.gameState.money;
  const p2MoneyBefore = p2.gameState.money;
  
  // Determine winner
  let winner;
  let tieUsed = false;
  
  if (p1.gameState.lastBid === p2.gameState.lastBid) {
    winner = drawAdvantage;
    tieUsed = true;
    // Switch advantage for next tie
    drawAdvantage = drawAdvantage === 1 ? 2 : 1;
  } else {
    winner = p1.gameState.lastBid > p2.gameState.lastBid ? 1 : 2;
  }

  // Move bottle
  const moveDirection = winner === 1 ? -1 : 1;
  scotchPosition = Math.max(0, Math.min(10, scotchPosition + moveDirection));

  // Only deduct bid from the winning player
  if (winner === 1) {
    p1.deductBidAmount();
  } else {
    p2.deductBidAmount();
  }

  // Update positions
  p1.updatePosition(scotchPosition);
  p2.updatePosition(scotchPosition);

  // Record turn history
  const turnData = {
    turnNumber,
    p1Name: p1.name,
    p2Name: p2.name,
    p1Bid: p1.gameState.lastBid,
    p2Bid: p2.gameState.lastBid,
    p1MoneyBefore,
    p2MoneyBefore,
    p1MoneyAfter: p1.gameState.money,
    p2MoneyAfter: p2.gameState.money,
    winner,
    tieUsed,
    oldPosition,
    newPosition: scotchPosition
  };

  turnHistory.push(turnData);
  p1.recordTurnHistory(turnData);
  p2.recordTurnHistory(turnData);

  // Log the game state for debugging
  console.log("Game state after turn:", {
    turnNumber,
    p1: {
      name: p1.name,
      money: p1.gameState.money,
      lastBid: p1.gameState.lastBid
    },
    p2: {
      name: p2.name,
      money: p2.gameState.money,
      lastBid: p2.gameState.lastBid
    },
    scotchPosition,
    gameOver
  });

  // Check game over conditions
  gameOver = scotchPosition === 0 || scotchPosition === 10 || turnNumber >= MAX_TURNS;

  // Send private updates first
  playerArray.forEach(player => {
    sendMessage(player.ws, {
      type: "PLAYER_UPDATE",
      money: player.player.gameState.money,
      lastBid: player.player.gameState.lastBid,
      isWinner: (player === p1 && winner === 1) || (player === p2 && winner === 2)
    });
  });

  // Then broadcast turn resolution
  broadcastAll({
    type: "TURN_RESOLVED",
    oldPosition,
    scotchPosition,
    gameOver,
    turnNumber,
    maxTurns: MAX_TURNS,
    winner,
    p1Bid: p1.gameState.lastBid,
    p2Bid: p2.gameState.lastBid
  });

  // Update AI history if applicable
  if (p1.isAI) {
    aiPlayers[p1.name].addToHistory({
      turnNumber,
      myBid: p1.gameState.lastBid,
      opponentBid: p2.gameState.lastBid,
      won: winner === 1
    });
  }
  if (p2.isAI) {
    aiPlayers[p2.name].addToHistory({
      turnNumber,
      myBid: p2.gameState.lastBid,
      opponentBid: p1.gameState.lastBid,
      won: winner === 2
    });
  }

  if (gameOver) {
    handleGameOver(p1, p2);
  } else {
    // Prepare for next turn
    turnNumber++;
    p1.player.gameState.hasSubmitted = false;
    p2.player.gameState.hasSubmitted = false;
    p1.player.gameState.lastBid = 0;
    p2.player.gameState.lastBid = 0;
    
    // Broadcast new bid status
    broadcastBidStatus();

    // Trigger AI bids after a short delay
    setTimeout(() => {
      playerArray.forEach(player => {
        if (player.player.isAI && !player.player.gameState.hasSubmitted) {
          handleAIBid(player.name);
        }
      });
    }, 1000);
  }
}

// Add a separate function to handle game over logic
function handleGameOver(p1, p2) {
  // Determine final winner based on position and money
  let finalWinner;
  if (scotchPosition <= 4) {
    finalWinner = p1.name; // Player 1's goal
  } else if (scotchPosition >= 6) {
    finalWinner = p2.name; // Player 2's goal
  } else {
    // Position is 5 (middle) - winner is player with more money
    finalWinner = p1.gameState.money > p2.gameState.money ? p1.name : 
                 p2.gameState.money > p1.gameState.money ? p2.name :
                 drawAdvantage === 1 ? p1.name : p2.name; // Use advantage for complete tie
  }
  const finalLoser = finalWinner === p1.name ? p2.name : p1.name;

  // Update leaderboard and get rating changes
  const ratingChanges = updateLeaderboard(finalWinner, finalLoser);

  // Create final state
  const finalState = {
    finalWinner,
    finalLoser,
    p1Name: p1.name,
    p2Name: p2.name,
    p1MoneyAfter: p1.gameState.money,
    p2MoneyAfter: p2.gameState.money,
    newPosition: scotchPosition
  };

  // Broadcast game over with all info
  broadcastAll({
    type: "GAME_OVER",
    turnHistory,
    ratingChanges,
    finalState,
    finalPosition: scotchPosition,
    winner: finalWinner
  });

  // Broadcast updated leaderboard
  broadcastLeaderboard();

  // Reset game after delay
  setTimeout(initGame, 5000);
}

//////////////////////////////////
// ELO Calculations
//////////////////////////////////
function calculateEloRating(winnerRating, loserRating) {
  const expectedScore = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
  const ratingChange = Math.round(K_FACTOR * (1 - expectedScore));
  return ratingChange;
}

function updatePlayerStats(playerName, won) {
  if (!leaderboardData.players[playerName]) {
    leaderboardData.players[playerName] = {
      rating: DEFAULT_RATING,
      wins: 0,
      losses: 0,
      gamesPlayed: 0
    };
  }
  
  const player = leaderboardData.players[playerName];
  player.gamesPlayed++;
  if (won) {
    player.wins++;
  } else {
    player.losses++;
  }
}

function updateLeaderboard(winner, loser) {
  // Get or create player ratings
  if (!leaderboardData.players[winner]) {
    leaderboardData.players[winner] = {
      rating: DEFAULT_RATING,
      wins: 0,
      losses: 0,
      gamesPlayed: 0
    };
  }
  if (!leaderboardData.players[loser]) {
    leaderboardData.players[loser] = {
      rating: DEFAULT_RATING,
      wins: 0,
      losses: 0,
      gamesPlayed: 0
    };
  }

  const winnerRating = leaderboardData.players[winner].rating;
  const loserRating = leaderboardData.players[loser].rating;

  // Calculate rating changes
  const ratingChange = calculateEloRating(winnerRating, loserRating);

  // Update ratings
  leaderboardData.players[winner].rating += ratingChange;
  leaderboardData.players[loser].rating -= ratingChange;

  // Update win/loss stats
  updatePlayerStats(winner, true);
  updatePlayerStats(loser, false);

  // Save to file
  fs.writeFileSync('leaderboard.json', JSON.stringify(leaderboardData, null, 2));

  // Return updated ratings for display
  return {
    winner: {
      name: winner,
      newRating: leaderboardData.players[winner].rating,
      ratingChange: ratingChange
    },
    loser: {
      name: loser,
      newRating: leaderboardData.players[loser].rating,
      ratingChange: -ratingChange
    }
  };
}

function broadcastLeaderboard() {
  const sortedPlayers = Object.entries(leaderboardData.players)
    .map(([name, stats]) => ({
      name,
      ...stats
    }))
    .sort((a, b) => b.rating - a.rating);

  broadcastAll({
    type: "LEADERBOARD_UPDATE",
    leaderboard: sortedPlayers
  });
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
        const { playerName, passcode, showBids, isAI, aiType } = data;
        console.log(`LOGIN attempt => Name: "${playerName}", Pass: "${passcode}", isAI: ${isAI}`);
        
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
        } else if (!isAI) {
          // Only check passcode match for human players
          if (passcode !== gamePasscode) {
            console.log("LOGIN_ERROR: Passcode mismatch.");
            return sendMessage(ws, {
              type: "LOGIN_ERROR",
              message: "Passcode does not match the existing game.",
            });
          }
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

        // Handle AI player creation
        if (isAI) {
          if (!aiPlayers[playerName]) {
            aiPlayers[playerName] = new AIPlayer(playerName, aiType);
          }
          // Reset AI history for new game
          aiPlayers[playerName].resetHistory();
        }

        // Create new player instance
        const player = new Player(playerName, isAI, aiType);
        
        // Register new player or update existing player's connection
        if (!players[playerName]) {
          players[playerName] = {
            player,
            ws,
            passcode: isAI ? 'ai_player' : passcode
          };
          console.log(`New player "${playerName}" joined${isAI ? ' as AI' : ` with passcode "${passcode}"`}`);
        } else {
          const existingPlayer = players[playerName];
          if (isAI || existingPlayer.passcode === passcode) {
            existingPlayer.ws = ws;
            console.log(`Player "${playerName}" ${isAI ? '(AI) ' : ''}reconnected`);
          } else {
            return sendMessage(ws, {
              type: "LOGIN_ERROR",
              message: "That name is used with a different passcode."
            });
          }
        }

        // Send success response
        sendMessage(ws, {
          type: "LOGIN_SUCCESS",
          playerName,
          money: player.gameState.money,
          showBidsMode,
          isFirstPlayer: Object.keys(players).length === 1,
          isAI
        });
        
        // Broadcast bid status if two players are connected
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
        if (!players[playerName]) return;

        const playerData = players[playerName];
        try {
          playerData.player.submitBid(bid);
          
          // Send confirmation to the player
          sendMessage(playerData.ws, {
            type: "PLAYER_UPDATE",
            money: playerData.player.gameState.money,
            lastBid: playerData.player.gameState.lastBid
          });

          // Broadcast bid status
          broadcastBidStatus();

          // Check if both players have submitted
          const playerArray = Object.values(players);
          if (playerArray.length === 2 && playerArray.every(p => p.player.gameState.hasSubmitted)) {
            resolveTurn();
          }
        } catch (error) {
          sendMessage(playerData.ws, {
            type: "BID_ERROR",
            message: error.message
          });
        }
        break;
      }

      case "REQUEST_LEADERBOARD":
        handleLeaderboardRequest(ws);
        break;

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

function handleLeaderboardRequest(ws) {
  const sortedPlayers = Object.entries(leaderboardData.players)
    .map(([name, stats]) => ({
      name,
      ...stats
    }))
    .sort((a, b) => b.rating - a.rating);

  ws.send(JSON.stringify({
    type: "LEADERBOARD_UPDATE",
    leaderboard: sortedPlayers
  }));
}
