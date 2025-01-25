// Player class definition for both browser and Node.js environments
(function(global) {
  class Player {
    constructor(name, isAI = false, aiType = null, ws = null, showBids = false, isFirstPlayer = false) {
      this.name = name;
      this.isAI = isAI;
      this.aiType = aiType; // 'openai', 'claude', or null
      this.ws = ws;
      this.showBids = showBids;
      this.isFirstPlayer = isFirstPlayer;
      this.money = 100; // Starting money
      this.currentBid = null;
      this.lastBid = null;
      this.bidSubmitted = false;
      this.rating = 1500; // Starting ELO rating
      this.wins = 0;
      this.losses = 0;
      this.gamesPlayed = 0;
      this.bidHistory = [];
      this.gameState = {
        money: 100,
        lastBid: 0,
        hasSubmitted: false,
        position: 5, // Start in middle
        history: [],
        turnNumber: 1
      };
    }
  
    // Retrieve current game state
    getGameState() {
      return {
        ...this.gameState,
        name: this.name,
        isAI: this.isAI,
        aiType: this.aiType,
        money: this.money,
        rating: this.rating,
        bidSubmitted: this.bidSubmitted
      };
    }
  
    // Update game state with new data
    updateGameState(newState) {
      this.gameState = { ...this.gameState, ...newState };
    }
  
    // Submit a bid for the current turn
    submitBid(amount) {
      if (amount > this.money) {
        throw new Error('Insufficient funds');
      }
      this.currentBid = amount;
      this.bidSubmitted = true;
    }
  
    // Deduct the bid amount from player's money
    deductBidAmount() {
      this.gameState.money -= this.gameState.lastBid;
    }
  
    // Record the turn history
    recordTurnHistory(turnData) {
      this.gameState.history.push(turnData);
    }
  
    // Reset player state for a new game
    reset() {
      this.money = 100;
      this.currentBid = null;
      this.lastBid = null;
      this.bidSubmitted = false;
      this.gameState = {
        money: 100,
        lastBid: 0,
        hasSubmitted: false,
        position: 5,
        history: [],
        turnNumber: 1
      };
      this.wins = 0;
      this.losses = 0;
      this.gamesPlayed = 0;
      this.bidHistory = [];
    }
  
    // Update player's position on the board
    updatePosition(newPosition) {
      this.gameState.position = newPosition;
    }
  
    // Prepare player for a new turn
    prepareTurn() {
      this.gameState.hasSubmitted = false;
      this.gameState.lastBid = 0;
    }
  
    // Get formatted history for display
    getFormattedHistory() {
      return this.gameState.history.map(turn => `Turn ${turn.turnNumber}: Bid $${turn.p1Bid} vs $${turn.p2Bid}`).join('\n');
    }
  
    updateMoney(change) {
      this.money += change;
      if (this.money < 0) this.money = 0;
    }
  
    updateRating(change) {
      const oldRating = this.rating;
      this.rating += change;
      if (this.rating < 0) this.rating = 0;
      return this.rating - oldRating;
    }
  
    placeBid(amount) {
      if (amount > this.money || amount < 0) {
        throw new Error('Invalid bid amount');
      }
      this.lastBid = amount;
      this.bidHistory.push(amount);
      return amount;
    }
  
    payBid() {
      if (this.lastBid === null) {
        throw new Error('No bid placed');
      }
      this.money -= this.lastBid;
      return this.lastBid;
    }
  
    recordGameResult(won) {
      if (won) {
        this.wins++;
      } else {
        this.losses++;
      }
      this.gamesPlayed++;
    }
  
    getStats() {
      return {
        name: this.name,
        rating: this.rating,
        wins: this.wins,
        losses: this.losses,
        gamesPlayed: this.gamesPlayed,
        winRate: this.gamesPlayed > 0 ? (this.wins / this.gamesPlayed) : 0
      };
    }
  
    toJSON() {
      return {
        name: this.name,
        isAI: this.isAI,
        aiType: this.aiType,
        showBids: this.showBids,
        isFirstPlayer: this.isFirstPlayer,
        money: this.money,
        rating: this.rating,
        bidSubmitted: this.bidSubmitted,
        wins: this.wins,
        losses: this.losses,
        gamesPlayed: this.gamesPlayed,
        lastBid: this.lastBid,
        bidHistory: this.bidHistory
      };
    }
  }

  // Export Player class
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Player;
  } else {
    global.Player = Player;
  }
})(this);
  