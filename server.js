const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { GameManager } = require('./server/gameManager');
const { MessageHandler } = require('./server/messageHandler');
const { LeaderboardManager } = require('./server/services/LeaderboardManager');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files from public directory
app.use(express.static('public'));

// Create managers
const leaderboard = new LeaderboardManager();
const gameManager = new GameManager(wss, leaderboard);
const messageHandler = new MessageHandler(wss, gameManager, leaderboard);

// WebSocket connection handling
wss.on('connection', (ws) => {
    console.log('New client connected');
    
    ws.on('message', (message) => {
        try {
            messageHandler.handleMessage(ws, message);
        } catch (error) {
            console.error('Error handling message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                error: error.message
            }));
        }
    });
    
    ws.on('close', () => {
        console.log('Client disconnected');
        gameManager.handleDisconnect(ws);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is listening on http://localhost:${PORT}`);
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