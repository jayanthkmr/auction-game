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
  }

  reset() {
    this.money = 100;
    this.currentBid = null;
    this.lastBid = null;
    this.bidSubmitted = false;
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
    this.rating += change;
    if (this.rating < 0) this.rating = 0;
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
      bidSubmitted: this.bidSubmitted
    };
  }
}

module.exports = Player; 