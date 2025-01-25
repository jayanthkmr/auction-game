class LeaderboardManager {
  constructor() {
    this.players = new Map();
  }

  addPlayer(player) {
    if (!this.players.has(player.name)) {
      this.players.set(player.name, player);
    }
    return this.players.get(player.name);
  }

  getPlayer(name) {
    return this.players.get(name);
  }

  updateRatings(winner, loser) {
    const K = 32; // Rating adjustment factor
    const expectedWinProbability = 1 / (1 + Math.pow(10, (loser.rating - winner.rating) / 400));
    const ratingChange = Math.round(K * (1 - expectedWinProbability));

    const oldWinnerRating = winner.rating;
    const oldLoserRating = loser.rating;

    winner.rating += ratingChange;
    loser.rating = Math.max(0, loser.rating - ratingChange);

    return {
      winner: {
        name: winner.name,
        ratingChange: ratingChange,
        newRating: winner.rating,
        oldRating: oldWinnerRating
      },
      loser: {
        name: loser.name,
        ratingChange: -ratingChange,
        newRating: loser.rating,
        oldRating: oldLoserRating
      }
    };
  }

  getLeaderboard() {
    const players = Array.from(this.players.values())
      .filter(p => p.gamesPlayed > 0)
      .map(p => p.toJSON())
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 10);

    return players;
  }
}

module.exports = {
  LeaderboardManager
}; 