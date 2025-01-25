const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const GameManager = require('./server/gameManager');
const MessageHandler = require('./server/messageHandler');
const { LeaderboardManager } = require('./server/services/LeaderboardManager');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static('public'));

// Create HTTP server
const server = app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Create game manager and leaderboard
const leaderboard = new LeaderboardManager();
const gameManager = new GameManager(wss, leaderboard);

// Create message handler
const messageHandler = new MessageHandler(gameManager, wss);

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('New WebSocket connection established.');

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      await messageHandler.handleMessage(ws, message);
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Internal server error'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    gameManager.handleDisconnect(ws);
  });
});

// Export for testing
module.exports = {
  app,
  server,
  wss,
  gameManager,
  messageHandler,
  leaderboard
}; 