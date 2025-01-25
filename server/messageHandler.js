// Import necessary modules
const { createMessage } = require('./messages');
const { broadcastAll, broadcastBidStatus } = require('./utils/websocket');
const { handleAIBid } = require('./services/gameService');

class MessageHandler {
  constructor(gameManager, wss) {
    this.gameManager = gameManager;
    this.wss = wss;
  }

  // Handle incoming messages
  async handleMessage(ws, rawData) {
    try {
      const message = createMessage(rawData);
      
      if (!message.validate()) {
        throw new Error('Invalid message format');
      }

      switch (message.type) {
        case 'LOGIN':
          await this.handleLogin(ws, message.data);
          break;
        case 'AUDIENCE_JOIN':
          await this.handleAudienceJoin(ws);
          break;
        case 'START_GAME':
          await this.handleStartGame(ws, message.data);
          break;
        case 'SUBMIT_BID':
          await this.handleBid(ws, message.data);
          break;
        case 'REQUEST_LEADERBOARD':
          await this.handleLeaderboardRequest(ws);
          break;
        default:
          throw new Error(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('Error handling message:', error);
      // Send error response to client
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: error.message
      }));
    }
  }

  // Handle login messages
  async handleLogin(ws, data) {
    const { playerName, passcode, showBids, isAI, aiType, isFirstPlayer } = data;
    
    // Validate login
    if (!this.gameManager.validateLogin(playerName, passcode)) {
      throw new Error('Invalid login credentials');
    }

    // Create player
    const player = await this.gameManager.createPlayer({
      name: playerName,
      isAI,
      aiType,
      ws,
      showBids,
      isFirstPlayer
    });

    // Send success response
    ws.send(JSON.stringify({
      type: 'LOGIN_SUCCESS',
      playerName: player.name,
      money: player.money,
      showBidsMode: showBids,
      isFirstPlayer,
      isAI
    }));

    // Broadcast updated game state
    this.gameManager.broadcastGameState();
  }

  async handleAudienceJoin(ws) {
    ws.send(JSON.stringify({ type: 'AUDIENCE_OK' }));
  }

  // Handle start game messages
  async handleStartGame(ws, data) {
    const { playerName } = data;
    const game = this.gameManager.getGameByPlayer(playerName);
    
    if (!game) {
      throw new Error('Game not found');
    }

    game.status = 'active';
    this.gameManager.broadcastGameState(game);

    // For AI vs AI games, trigger initial bids
    if (this.gameManager.isAIGame(game)) {
      if (game.player1.isAI) {
        await handleAIBid(game, game.player1);
      }
      if (game.player2.isAI) {
        await handleAIBid(game, game.player2);
      }
    }
  }

  // Handle bid submission messages
  async handleBid(ws, data) {
    const { playerName, bid } = data;
    const game = this.gameManager.getGameByPlayer(playerName);
    
    if (!game) {
      throw new Error('Game not found');
    }

    await this.gameManager.submitBid(game, playerName, bid);
    
    // If both players have bid, resolve the turn
    if (game.player1.bidSubmitted && game.player2.bidSubmitted) {
      await this.gameManager.resolveTurn(game);
      
      // Request next AI bids if needed
      if (this.gameManager.isAIGame(game) && game.status === 'active') {
        if (game.player1.isAI) {
          await handleAIBid(game, game.player1);
        }
        if (game.player2.isAI) {
          await handleAIBid(game, game.player2);
        }
      }
    } else {
      broadcastBidStatus(this.wss, game);
    }
  }

  async handleLeaderboardRequest(ws) {
    ws.send(JSON.stringify({
      type: 'LEADERBOARD_UPDATE',
      leaderboard: this.gameManager.leaderboard.getLeaderboard()
    }));
  }
}

module.exports = MessageHandler; 