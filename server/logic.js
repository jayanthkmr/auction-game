/**
 * server.js
 * Run with: node server.js
 */

// Core imports
const AIAgent = require('./ai_agents');
const Player = require('./models/Player');
const { sendMessage, broadcastAll, broadcastBidStatus } = require('./utils/websocket');
const { handleAIBid, resolveTurn, handleGameOver } = require('./services/gameService');
const { LeaderboardManager } = require('./services/LeaderboardManager');

// Initialize game logic
function initializeGameLogic(wss) {
  // Initialize game state
  const gameState = {
    players: [],
    scores: {},
    currentTurn: 0,
    maxTurns: 10,
    bottlePosition: 5 // Starting position
  };

  // Set up WebSocket event listeners
  wss.on('connection', (ws) => {
    console.log('New player connected');

    // Handle incoming messages
    ws.on('message', (message) => {
      // Process message and update game state
      // Example: handlePlayerAction(ws, message, gameState);
    });

    // Handle player disconnection
    ws.on('close', () => {
      console.log('Player disconnected');
      // Update game state accordingly
    });
  });

  // Additional initialization logic if needed
  // Example: initializeAIPlayers(gameState);
}

// K-factor determines how much ratings can change in a single game
const K_FACTOR = 32;

function calculateExpectedScore(playerRating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}

function calculateEloChange(winner, loser) {
  const expectedWinnerScore = calculateExpectedScore(winner.rating, loser.rating);
  const expectedLoserScore = calculateExpectedScore(loser.rating, winner.rating);
  
  // Winner gets 1, loser gets 0
  const winnerDelta = Math.round(K_FACTOR * (1 - expectedWinnerScore));
  const loserDelta = Math.round(K_FACTOR * (0 - expectedLoserScore));
  
  return [winnerDelta, loserDelta];
}

// Export necessary functions and objects
module.exports = {
  initializeGameLogic,
  handleAIBid,
  resolveTurn,
  handleGameOver,
  LeaderboardManager,
  calculateEloChange,
  AIAgent,
  Player
};
