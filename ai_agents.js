const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

class AIPlayer {
  constructor(name, type) {
    this.name = name;
    this.type = type; // 'openai' or 'claude'
    this.gameHistory = [];
  }

  async decideBid(gameState) {
    const { myMoney, bottlePosition, turnNumber, maxTurns, opponentName } = gameState;
    
    // Prepare context for the AI
    const context = `
      You are playing a Scotch Auction game. Current state:
      - Your money: $${myMoney}
      - Bottle position: ${bottlePosition} (0-10 scale)
      - Turn: ${turnNumber}/${maxTurns}
      - Playing against: ${opponentName}
      
      Game rules:
      - Higher bid wins and moves bottle 1 step toward their goal
      - Winner pays their bid, loser keeps their money
      - You win by getting bottle to your end (0 or 10) or most progress in ${maxTurns} turns
      
      Previous turns: ${this.formatHistory()}
      
      Decide a bid amount (max: $${myMoney}). Consider:
      1. Bottle position and distance to goal
      2. Remaining turns
      3. Your money vs potential strategic value
      4. Opponent's likely strategy
      
      Respond with ONLY a number representing your bid.
    `;

    try {
      if (this.type === 'openai') {
        const response = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [{ role: "user", content: context }],
          temperature: 0.7,
          max_tokens: 10
        });
        const bid = parseInt(response.choices[0].message.content.trim());
        return this.validateBid(bid, myMoney);
      } else {
        const response = await anthropic.messages.create({
          model: "claude-3-sonnet-20240229",
          max_tokens: 10,
          temperature: 0.7,
          messages: [{ role: "user", content: context }]
        });
        const bid = parseInt(response.content[0].text.trim());
        return this.validateBid(bid, myMoney);
      }
    } catch (error) {
      console.error(`AI Bid Error (${this.type}):`, error);
      // Fallback to a simple strategy if AI fails
      return Math.floor(Math.random() * (myMoney + 1));
    }
  }

  validateBid(bid, maxMoney) {
    if (isNaN(bid) || bid < 0) return 0;
    if (bid > maxMoney) return maxMoney;
    return Math.floor(bid);
  }

  formatHistory() {
    if (this.gameHistory.length === 0) return "No previous turns";
    return this.gameHistory.map(turn => 
      `Turn ${turn.turnNumber}: You bid $${turn.myBid}, opponent bid $${turn.opponentBid}, ` +
      `${turn.won ? 'you won' : 'opponent won'}`
    ).join('\n');
  }

  addToHistory(turnData) {
    this.gameHistory.push(turnData);
  }

  resetHistory() {
    this.gameHistory = [];
  }
}

module.exports = {
  AIPlayer,
  AI_NAMES: {
    CLAUDE: "Claude-AI",
    OPENAI: "GPT4-AI"
  }
}; 