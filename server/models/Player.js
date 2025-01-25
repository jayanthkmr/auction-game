class Player {
  constructor(name, ws, isAI = false, aiType = null) {
    this.name = name;
    this.ws = ws;
    this.money = 100;
    this.lastBid = null;
    this.isAI = isAI;
    this.aiType = aiType;
    this.rating = 1500; // Initial ELO rating
    this.gamesPlayed = 0;
    this.wins = 0;
    this.losses = 0;
  }

  submitBid(amount) {
    if (amount < 0 || amount > this.money) {
      throw new Error(`Invalid bid amount. Must be between 0 and ${this.money}`);
    }
    this.lastBid = amount;
    this.money -= amount;
    return true;
  }

  refundBid() {
    if (this.lastBid !== null) {
      this.money += this.lastBid;
      this.lastBid = null;
    }
  }

  updateStats(won) {
    this.gamesPlayed++;
    if (won) {
      this.wins++;
    } else {
      this.losses++;
    }
  }

  toJSON() {
    return {
      name: this.name,
      rating: Math.round(this.rating),
      gamesPlayed: this.gamesPlayed,
      wins: this.wins,
      losses: this.losses,
      winRate: this.gamesPlayed > 0 ? Math.round((this.wins / this.gamesPlayed) * 100) : 0
    };
  }
}

module.exports = { Player }; 