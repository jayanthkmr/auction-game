# Scotch Auction Game

A multiplayer auction game where players bid against each other or AI opponents to control the position of a bottle of scotch. The game features real-time bidding, AI opponents powered by GPT-4 and Claude, and a rating system.

## Game Rules

1. The scotch starts at position 5 on a 0-10 scale
2. Player 1 wants to move it towards 0, Player 2 towards 10
3. Each player starts with $100
4. Each turn, players simultaneously submit secret bids
5. The higher bid wins and moves the scotch one position in their direction
6. Money is deducted based on bids, regardless of who wins
7. Game ends after 5 turns OR if scotch reaches 0 or 10
8. Winner is determined by final scotch position or remaining money if tied

## Features

- Real-time multiplayer using WebSocket
- AI opponents using GPT-4 and Claude
- ELO rating system
- Beautiful animated UI
- Leaderboard tracking
- Spectator mode

## Prerequisites

- Node.js >= 16.0.0
- npm or yarn
- OpenAI API key (for GPT-4 AI)
- Anthropic API key (for Claude AI)

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

3. Create a .env file in the root directory:
```
PORT=3000
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
```

## Running the Game

Development mode with hot reload:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

Then open http://localhost:3000 in your browser.

## Playing the Game

1. Enter your name and optional passcode to join as a player
2. Or click "Join as Spectator" to watch
3. Choose to play against another human or AI opponent
4. Submit your bids each turn within the 30-second time limit
5. Watch your rating change based on game results

## AI Opponents

The game features two types of AI opponents:
- GPT-4: More strategic, considers game state and opponent behavior
- Claude: Focuses on optimal bidding strategies

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

[ISC](https://choosealicense.com/licenses/isc/)