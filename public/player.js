// Player class definition for both browser and Node.js environments
(function(global) {
  class Player {
    constructor(name, isAI = false, aiType = null) {
      this.name = name;
      this.isAI = isAI;
      this.aiType = aiType; // 'openai', 'claude', or null
      this.gameState = {
        money: 100,
        lastBid: 0,
        hasSubmitted: false,
        position: 5, // Start in middle
        history: [],
        turnNumber: 1
      };
    }
  
    // Game state management
    getGameState() {
      return {
        ...this.gameState,
        name: this.name,
        isAI: this.isAI,
        aiType: this.aiType
      };
    }
  
    updateGameState(newState) {
      this.gameState = { ...this.gameState, ...newState };
    }
  
    // Bid management
    submitBid(bid) {
      if (bid < 0 || bid > this.gameState.money) {
        throw new Error(`Invalid bid amount. Maximum bid is $${this.gameState.money}`);
      }
      this.gameState.lastBid = bid;
      this.gameState.hasSubmitted = true;
      return true;
    }
  
    // Money management
    deductBidAmount() {
      if (this.gameState.lastBid > this.gameState.money) {
        throw new Error('Insufficient funds');
      }
      this.gameState.money -= this.gameState.lastBid;
      return this.gameState.money;
    }
  
    // History management
    recordTurnHistory(turnData) {
      this.gameState.history.push({
        turnNumber: this.gameState.turnNumber,
        bid: this.gameState.lastBid,
        moneyBefore: this.gameState.money + this.gameState.lastBid,
        moneyAfter: this.gameState.money,
        position: this.gameState.position,
        ...turnData
      });
      this.gameState.turnNumber++;
    }
  
    // Game reset
    reset() {
      this.gameState = {
        money: 100,
        lastBid: 0,
        hasSubmitted: false,
        position: 5,
        history: [],
        turnNumber: 1
      };
    }
  
    // Position management
    updatePosition(newPosition) {
      if (newPosition < 0 || newPosition > 10) {
        throw new Error('Invalid position');
      }
      this.gameState.position = newPosition;
    }
  
    // Turn management
    prepareTurn() {
      this.gameState.hasSubmitted = false;
      this.gameState.lastBid = 0;
    }
  
    // Utility methods
    getFormattedHistory() {
      if (this.gameState.history.length === 0) return "No previous turns";
      return this.gameState.history.map(turn => 
        `Turn ${turn.turnNumber}: Bid $${turn.bid}, ` +
        `Money: ${turn.moneyBefore} → ${turn.moneyAfter}, ` +
        `Position: ${turn.position}`
      ).join('\n');
    }
  }

  // Export for both browser and Node.js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Player;
  } else {
    global.Player = Player;
  }
})(typeof window !== 'undefined' ? window : global);
  