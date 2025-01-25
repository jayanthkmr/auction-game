# Scotch Auction Game

A multiplayer auction game where players bid to move a bottle of scotch towards their end of the board. Play against other humans or AI opponents!

## Game Rules

1. **Setup**
   - 2 players compete
   - Each starts with $100
   - Bottle starts in the middle (position 5)

2. **Bidding**
   - Players bid secretly each turn
   - Higher bid wins the turn
   - Winner pays their bid
   - Loser keeps their money

3. **Movement**
   - Winner moves bottle 1 step their way
   - Player 1 moves left (towards 0)
   - Player 2 moves right (towards 10)

4. **Winning**
   - Get bottle to your end (0 or 10)
   - Or have most progress after 5 turns
   - Ties use alternating advantage

## Features

- Real-time multiplayer using WebSocket
- Play against AI opponents (Claude or GPT-4)
- Watch AI vs AI matches
- ELO rating system
- Leaderboard tracking
- Game replay system
- Spectator mode

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/scotch-auction-game.git
   cd scotch-auction-game
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

4. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Development

To run the server in development mode with auto-reload:
```bash
npm run dev
```

## Testing

Run the test suite:
```bash
npm test
```

## Technologies Used

- Node.js
- Express
- WebSocket (ws)
- HTML5 Canvas
- CSS3

## License

MIT License - See LICENSE file for details