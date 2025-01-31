// Import necessary modules
const { createMessage } = require('./messages');
const { broadcastAll, broadcastBidStatus } = require('./utils/websocket');
const { handleAIBid } = require('./services/gameService');

class MessageHandler {
  constructor(wss, gameManager, leaderboard) {
    this.wss = wss;
    this.gameManager = gameManager;
    this.leaderboard = leaderboard;
  }

  handleMessage(ws, message) {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data);
      
      if (!data.type) {
        throw new Error('Invalid message format');
      }

      switch (data.type.toUpperCase()) {
        case 'LOGIN':
          this.handleLogin(ws, data);
          break;
        case 'AUDIENCE_JOIN':
          this.handleAudienceJoin(ws);
          break;
        case 'SUBMIT_BID':
          this.handleBid(ws, data);
          break;
        case 'REQUEST_LEADERBOARD':
          this.handleLeaderboardRequest(ws);
          break;
        case 'START_GAME':
          this.handleStartGame(ws, data);
          break;
        default:
          console.warn('Unknown message type:', data.type);
          throw new Error('Unknown message type: ' + data.type);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: error.message
      }));
    }
  }

  handleLogin(ws, data) {
    try {
      const { playerName, passcode, showBids } = data;
      
      if (!playerName) {
        throw new Error('Player name is required');
      }

      // Determine if this is the first player
      const isFirstPlayer = this.gameManager.activePlayers.size === 0;

      // Create or join game
      const game = this.gameManager.handlePlayerJoin(ws, playerName, false, null, showBids, isFirstPlayer, passcode);
      
      // Send success response with passcode for first player
      ws.send(JSON.stringify({
        type: 'LOGIN_SUCCESS',
        playerName: playerName,
        passcode: passcode, // Send back the same passcode that was provided
        isFirstPlayer: isFirstPlayer,
        showBidsMode: game.showBids
      }));

      // Broadcast game state to all players
      if (game.status === 'active') {
        this.gameManager.broadcastGameState(game);
        this.gameManager.broadcastBidStatus(game);
      }

    } catch (error) {
      console.error('Login error:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: error.message
      }));
    }
  }

  handleAudienceJoin(ws) {
    this.gameManager.handleAudienceJoin(ws);
    
    ws.send(JSON.stringify({
      type: 'AUDIENCE_OK'
    }));
  }

  handleStartGame(ws, data) {
    try {
      const { playerName } = data;
      const game = this.gameManager.getGameByPlayer(playerName);
      
      if (!game) {
        throw new Error('Game not found');
      }

      if (game.players.length !== 2) {
        throw new Error('Waiting for second player');
      }

      if (game.status === 'active') {
        throw new Error('Game already started');
      }

      // Start the game
      game.status = 'active';
      this.gameManager.broadcastGameState(game);
      this.gameManager.broadcastBidStatus(game);
    } catch (error) {
      console.error('Start game error:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: error.message
      }));
    }
  }

  handleBid(ws, data) {
    try {
      const { playerName, bid } = data;
      
      if (typeof bid !== 'number' || bid < 0) {
        throw new Error('Invalid bid amount');
      }

      // Get the game for this player
      const game = this.gameManager.getGameByPlayer(playerName);
      if (!game) {
        throw new Error('Game not found');
      }

      // Verify game is active
      if (game.status !== 'active') {
        throw new Error('Game has not started yet');
      }

      // Find the player in the game
      const player = game.players.find(p => p.name === playerName);
      if (!player) {
        throw new Error('Player not found in game');
      }

      // Verify this is the player's websocket
      if (player.ws !== ws) {
        throw new Error('Invalid player connection');
      }

      // Place the bid
      this.gameManager.placeBid(game, player, bid);
    } catch (error) {
      console.error('Error handling bid:', error);
      ws.send(JSON.stringify({
        type: 'BID_ERROR',
        message: error.message
      }));
    }
  }

  handleLeaderboardRequest(ws) {
    const leaderboardData = this.leaderboard.getLeaderboard();
    ws.send(JSON.stringify({
      type: 'LEADERBOARD_UPDATE',
      leaderboard: leaderboardData
    }));
  }
}

module.exports = { MessageHandler }; 