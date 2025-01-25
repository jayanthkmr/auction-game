const express = require('express');
const { WebSocketServer } = require('ws');
const { MessageHandler } = require('./server/messageHandler');
const { GameManager } = require('./server/gameManager');
const { LeaderboardManager } = require('./server/services/LeaderboardManager');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from public directory
app.use(express.static('public'));

// Create HTTP server
const server = app.listen(port, () => {
    console.log(`Server is listening on http://localhost:${port}`);
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Initialize managers
const leaderboard = new LeaderboardManager();
const gameManager = new GameManager(wss, leaderboard);
const messageHandler = new MessageHandler(wss, gameManager, leaderboard);

// Handle WebSocket connections
wss.on('connection', (ws) => {
    console.log('New client connected');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('Received message:', data);
            messageHandler.handleMessage(ws, message);
        } catch (error) {
            console.error('Error handling message:', error);
            ws.send(JSON.stringify({
                type: 'ERROR',
                message: error.message
            }));
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        gameManager.handleDisconnect(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
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