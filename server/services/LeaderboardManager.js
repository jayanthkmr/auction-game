class LeaderboardManager {
  constructor() {
    this.players = new Map();
  }

  addPlayer(player) {
    if (!this.players.has(player.name)) {
      this.players.set(player.name, player);
    }
  }

  updateRatings(winner, loser) {
    const K = 32; // K-factor for ELO calculation
    const expectedScore = 1 / (1 + Math.pow(10, (loser.rating - winner.rating) / 400));
    const ratingChange = Math.round(K * (1 - expectedScore));

    winner.updateRating(winner.rating + ratingChange);
    loser.updateRating(loser.rating - ratingChange);

    return ratingChange;
  }

  getLeaderboard() {
    return Array.from(this.players.values())
      .map(player => ({
        name: player.name,
        rating: player.rating,
        wins: player.wins,
        losses: player.losses,
        gamesPlayed: player.gamesPlayed,
        winRate: player.gamesPlayed > 0 ? (player.wins / player.gamesPlayed) : 0
      }))
      .sort((a, b) => b.rating - a.rating);
  }
}

module.exports = {
  LeaderboardManager
}; 