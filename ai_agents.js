const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const Player = require('./public/player.js');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

class AIPlayer extends Player {
  constructor(name, type) {
    super(name, true, type);
    this.type = type; // 'openai' or 'claude'
    this.aiHistory = []; // Separate AI-specific history
  }

  async decideBid(gameState) {
    const { bottlePosition, turnNumber, maxTurns, opponentName } = gameState;
    const myMoney = this.gameState.money;
    
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
      
      Previous turns: ${this.formatAIHistory()}
      
      Decide a bid amount (max: $${myMoney}). Consider:
      1. Bottle position and distance to goal
      2. Remaining turns
      3. Your money vs potential strategic value
      4. Opponent's likely strategy
      
      Respond with ONLY a number representing your bid.
    `;

    try {
      let bid;
      if (this.type === 'openai') {
        const response = await openai.chat.completions.create({
          model: "gpt-4",
          messages: [{ role: "user", content: context }],
          temperature: 0.7,
          max_tokens: 10
        });
        bid = parseInt(response.choices[0].message.content.trim());
      } else {
        const response = await anthropic.messages.create({
          model: "claude-3-sonnet-20240229",
          max_tokens: 10,
          temperature: 0.7,
          messages: [{ role: "user", content: context }]
        });
        bid = parseInt(response.content[0].text.trim());
      }

      // Use the Player class's submitBid method for validation
      try {
        this.submitBid(bid);
        return bid;
      } catch (error) {
        console.log(`Invalid bid from AI (${bid}), using fallback`);
        const fallbackBid = Math.floor(Math.random() * (myMoney + 1));
        this.submitBid(fallbackBid);
        return fallbackBid;
      }
    } catch (error) {
      console.error(`AI Bid Error (${this.type}):`, error);
      // Fallback to a simple strategy if AI fails
      const fallbackBid = Math.floor(Math.random() * (myMoney + 1));
      this.submitBid(fallbackBid);
      return fallbackBid;
    }
  }

  // AI-specific history management
  formatAIHistory() {
    if (this.aiHistory.length === 0) return "No previous turns";
    return this.aiHistory.map(turn => 
      `Turn ${turn.turnNumber}: You bid $${turn.myBid}, opponent bid $${turn.opponentBid}, ` +
      `${turn.won ? 'you won' : 'opponent won'}`
    ).join('\n');
  }

  addToHistory(turnData) {
    // Add to both Player history and AI-specific history
    super.recordTurnHistory(turnData);
    this.aiHistory.push(turnData);
  }

  resetHistory() {
    // Reset both Player history and AI-specific history
    super.reset();
    this.aiHistory = [];
  }
}

module.exports = {
  AIPlayer,
  AI_NAMES: {
    CLAUDE: "Claude-AI",
    GPT4: "GPT4-AI"
  }
}; 