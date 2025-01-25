class Player {
  constructor(name, isAI = false, aiType = null, ws = null, showBids = false, isFirstPlayer = false) {
    this.name = name;
    this.isAI = isAI;
    this.aiType = aiType;
    this.ws = ws;
    this.showBids = showBids;
    this.isFirstPlayer = isFirstPlayer;
    this.money = 100;
    this.currentBid = null;
    this.lastBid = null;
    this.bidSubmitted = false;
    this.rating = 1500;
    this.wins = 0;
    this.losses = 0;
    this.gamesPlayed = 0;
    this.bidHistory = [];
  }

  reset() {
    this.money = 100;
    this.currentBid = null;
    this.lastBid = null;
    this.bidSubmitted = false;
    this.bidHistory = [];
  }

  submitBid(amount) {
    if (amount > this.money) {
      throw new Error('Insufficient funds');
    }
    this.currentBid = amount;
    this.bidSubmitted = true;
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

module.exports = Player; 