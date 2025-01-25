const Player = require('./models/Player');
const { calculateEloChange } = require('./logic');
const { broadcastAll } = require('./utils/websocket');

class GameManager {
  constructor(wss, leaderboard) {
    this.wss = wss;
    this.leaderboard = leaderboard;
    this.games = new Map(); // gameId -> game object
    this.players = new Map(); // playerName -> player object
    this.MAX_TURNS = 5;
  }

  // Validate player login
  validateLogin(playerName, passcode) {
    // For now, just check if the name is available
    return !this.players.has(playerName);
  }

  // Create a new player
  async createPlayer({ name, isAI, aiType, ws, showBids, isFirstPlayer }) {
    if (this.players.has(name)) {
      throw new Error('Player name already taken');
    }

    const player = new Player(name, isAI, aiType, ws, showBids, isFirstPlayer);
    this.players.set(name, player);
    
    // Add to leaderboard if not already there
    this.leaderboard.addPlayer(name, player.rating);
    
    return player;
  }

  // Create a new game
  createGame(player1Name, player2Name) {
    const gameId = `${player1Name}_vs_${player2Name}`;
    const game = {
      id: gameId,
      player1: this.players.get(player1Name),
      player2: this.players.get(player2Name),
      currentTurn: 0,
      scotchPosition: 5,
      turnHistory: [],
      status: 'waiting', // waiting, active, finished
      winner: null,
      wss: this.wss
    };
    
    this.games.set(gameId, game);
    return game;
  }

  // Get game by player name
  getGameByPlayer(playerName) {
    const player = this.players.get(playerName);
    if (!player) return null;

    for (const [_, game] of this.games) {
      if (game.player1.name === playerName || game.player2.name === playerName) {
        return game;
      }
    }
    return null;
  }

  // Broadcast updated game state
  broadcastGameState(game) {
    const gameState = {
      type: 'GAME_STATE',
      currentTurn: game.currentTurn,
      scotchPosition: game.scotchPosition,
      status: game.status,
      player1: game.player1.toJSON(),
      player2: game.player2.toJSON(),
      turnHistory: game.turnHistory
    };

    const p1State = JSON.stringify({...gameState, isYourTurn: !game.player1.bidSubmitted});
    const p2State = JSON.stringify({...gameState, isYourTurn: !game.player2.bidSubmitted});

    if (game.player1.ws) game.player1.ws.send(p1State);
    if (game.player2.ws) game.player2.ws.send(p2State);

    // Send state to audience (without isYourTurn)
    this.wss.clients.forEach(client => {
      if (client !== game.player1.ws && client !== game.player2.ws && client.readyState === 1) {
        client.send(JSON.stringify(gameState));
      }
    });
  }

  // Handle player disconnection
  handleDisconnect(ws) {
    let disconnectedPlayer = null;
    for (const [name, player] of this.players) {
      if (player.ws === ws) {
        disconnectedPlayer = player;
        this.players.delete(name);
        break;
      }
    }

    if (disconnectedPlayer) {
      for (const [id, game] of this.games) {
        if (game.player1 === disconnectedPlayer || game.player2 === disconnectedPlayer) {
          game.status = 'finished';
          game.winner = game.player1 === disconnectedPlayer ? game.player2 : game.player1;
          
          // Update ratings for disconnect
          if (game.winner) {
            const [winnerDelta, loserDelta] = calculateEloChange(game.winner, disconnectedPlayer);
            game.winner.updateRating(winnerDelta);
            disconnectedPlayer.updateRating(loserDelta);
            this.leaderboard.updateRatings(game.winner, disconnectedPlayer, winnerDelta, loserDelta);
          }
          
          this.broadcastGameState(game);
          broadcastAll(this.wss, {
            type: 'GAME_OVER',
            disconnect: disconnectedPlayer.name,
            turnHistory: game.turnHistory,
            ratingChanges: game.winner ? {
              winner: {
                name: game.winner.name,
                ratingChange: winnerDelta,
                newRating: game.winner.rating
              },
              loser: {
                name: disconnectedPlayer.name,
                ratingChange: loserDelta,
                newRating: disconnectedPlayer.rating
              }
            } : null
          });
          
          this.games.delete(id);
        }
      }
    }
  }

  // Submit a bid
  async submitBid(game, playerName, bidAmount) {
    const player = this.players.get(playerName);
    if (!player) throw new Error('Player not found');
    
    if (game.status !== 'active') throw new Error('Game is not active');
    if (player.bidSubmitted) throw new Error('Bid already submitted');
    
    player.submitBid(bidAmount);
    
    // Check if both players have submitted
    if (game.player1.bidSubmitted && game.player2.bidSubmitted) {
      await this.resolveTurn(game);
    } else {
      this.broadcastGameState(game);
    }
  }

  // Resolve a turn
  async resolveTurn(game) {
    const p1Bid = game.player1.currentBid;
    const p2Bid = game.player2.currentBid;
    
    // Record turn history
    game.turnHistory.push({
      turn: game.currentTurn + 1,
      p1Bid,
      p2Bid,
      oldPosition: game.scotchPosition
    });

    // Update scotch position based on bids
    if (p1Bid > p2Bid) {
      game.scotchPosition = Math.max(0, game.scotchPosition - 1);
    } else if (p2Bid > p1Bid) {
      game.scotchPosition = Math.min(10, game.scotchPosition + 1);
    }
    
    // Update player money
    game.player1.updateMoney(-p1Bid);
    game.player2.updateMoney(-p2Bid);
    
    // Reset bids
    game.player1.bidSubmitted = false;
    game.player2.bidSubmitted = false;
    game.player1.currentBid = null;
    game.player2.currentBid = null;
    
    game.currentTurn++;

    // Check for game end
    if (game.currentTurn >= this.MAX_TURNS || game.scotchPosition === 0 || game.scotchPosition === 10) {
      await this.endGame(game);
    } else {
      this.broadcastGameState(game);
    }
  }

  // End a game
  async endGame(game) {
    game.status = 'finished';
    
    // Determine winner
    if (game.scotchPosition < 5) {
      game.winner = game.player1;
    } else if (game.scotchPosition > 5) {
      game.winner = game.player2;
    } else {
      // If tied at position 5, player with more money wins
      if (game.player1.money > game.player2.money) {
        game.winner = game.player1;
      } else if (game.player2.money > game.player1.money) {
        game.winner = game.player2;
      }
      // If still tied, no winner
    }

    // Update ratings if there's a winner
    if (game.winner) {
      const loser = game.winner === game.player1 ? game.player2 : game.player1;
      const [winnerDelta, loserDelta] = calculateEloChange(game.winner, loser);
      
      game.winner.updateRating(winnerDelta);
      loser.updateRating(loserDelta);
      
      this.leaderboard.updateRatings(game.winner, loser, winnerDelta, loserDelta);
      
      broadcastAll(this.wss, {
        type: 'GAME_OVER',
        turnHistory: game.turnHistory,
        finalState: {
          p1Name: game.player1.name,
          p2Name: game.player2.name,
          p1MoneyAfter: game.player1.money,
          p2MoneyAfter: game.player2.money,
          newPosition: game.scotchPosition,
          finalWinner: game.winner.name
        },
        ratingChanges: {
          winner: {
            name: game.winner.name,
            ratingChange: winnerDelta,
            newRating: game.winner.rating
          },
          loser: {
            name: loser.name,
            ratingChange: loserDelta,
            newRating: loser.rating
          }
        }
      });
    }

    // Broadcast updated leaderboard
    broadcastAll(this.wss, {
      type: 'LEADERBOARD_UPDATE',
      leaderboard: this.leaderboard.getLeaderboard()
    });
  }

  // Check if a game is AI-controlled
  isAIGame(game) {
    return game.player1.isAI || game.player2.isAI;
  }
}

module.exports = GameManager; 