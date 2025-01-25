class LeaderboardManager {
  constructor() {
    this.players = new Map();
  }

  addPlayer(name, rating = 1500) {
    if (!this.players.has(name)) {
      this.players.set(name, {
        name,
        rating,
        wins: 0,
        losses: 0,
        gamesPlayed: 0
      });
    }
    return this.players.get(name);
  }

  updateRatings(winner, loser, winnerDelta, loserDelta) {
    const winnerStats = this.players.get(winner.name) || this.addPlayer(winner.name, winner.rating);
    const loserStats = this.players.get(loser.name) || this.addPlayer(loser.name, loser.rating);

    winnerStats.rating += winnerDelta;
    loserStats.rating += loserDelta;
    
    winnerStats.wins++;
    loserStats.losses++;
    winnerStats.gamesPlayed++;
    loserStats.gamesPlayed++;
  }

  getLeaderboard() {
    return Array.from(this.players.values())
      .sort((a, b) => b.rating - a.rating)
      .map(player => ({
        name: player.name,
        rating: player.rating,
        wins: player.wins,
        losses: player.losses,
        gamesPlayed: player.gamesPlayed
      }));
  }
}

module.exports = {
  LeaderboardManager
}; 