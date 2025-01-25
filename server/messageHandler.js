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
    const { playerName, passcode, showBids, isAI, aiType, isFirstPlayer } = data;
    
    // Validate input
    if (!playerName || playerName.length > 20) {
      throw new Error('Invalid name');
    }

    // Create player and start/join game
    const game = this.gameManager.handlePlayerJoin(ws, playerName, isAI, aiType, showBids, isFirstPlayer);
    
    // Send login success response
    ws.send(JSON.stringify({
      type: 'LOGIN_SUCCESS',
      playerName: playerName,
      money: 100,
      showBidsMode: showBids,
      isFirstPlayer: isFirstPlayer,
      isAI: isAI
    }));

    // If this completes a game, broadcast state
    if (game) {
      this.gameManager.broadcastGameState(game);
    }
  }

  handleAudienceJoin(ws) {
    this.gameManager.handleAudienceJoin(ws);
    
    ws.send(JSON.stringify({
      type: 'AUDIENCE_OK'
    }));
  }

  handleStartGame(ws, data) {
    const { playerName } = data;
    const game = this.gameManager.getGameByPlayer(playerName);
    
    if (!game) {
      throw new Error('Game not found');
    }

    // Start the game
    game.status = 'active';
    this.gameManager.broadcastGameState(game);

    // For AI vs AI games, trigger initial bids
    if (game.players.some(p => p.isAI)) {
      game.players.forEach(player => {
        if (player.isAI) {
          handleAIBid(game, player);
        }
      });
    }
  }

  handleBid(ws, data) {
    const { playerName, bid } = data;
    
    if (typeof bid !== 'number' || bid < 0) {
      throw new Error('Invalid bid amount');
    }

    const success = this.gameManager.placeBid(ws, bid);
    if (!success) {
      throw new Error('Failed to place bid');
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