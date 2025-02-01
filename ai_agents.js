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
    const { myMoney, bottlePosition, turnNumber, maxTurns, opponentName, myGoal } = gameState;
    
    // Prepare context for the AI
    const context = `
      You are playing a Scotch Auction game. Current state: 
      - Your money: $${myMoney}
      - Bottle position: ${bottlePosition} (0-10 scale)
      - Your goal: ${myGoal}
      - Turn: ${turnNumber}/${maxTurns}
      - Playing against: ${opponentName}
      - Your distance to goal: ${Math.abs(myGoal - bottlePosition)}
      - Opponent's distance to goal: ${Math.abs(10 - myGoal - bottlePosition)}
      
      Game rules:
      - Higher bid wins and moves bottle 1 step toward their goal
      - Ties use alternating advantage, if you tie with the opponent, the turn goes to the player with equal parity to turn number
      - Winner pays their bid, loser keeps their money
      - Game ends after ${maxTurns} turns or when bottle reaches either end (0 or 10) or both players have no money
      - You win by getting bottle to your end ${myGoal}, depending on your player number or most progress towards your end after the game ends
      
      Here is a sample past game run between two smartest AIs for you to analyze:

              === GAME REPLAY ===

        === Turn 1/100 ===

        C-AI bid: $5
        O-AI bid: $1

        C-AI won the turn

        Money changes:
        C-AI: $100 → $95
        O-AI: $100 → $100

        Bottle moved: 5 → 4
        ------------------------

        === Turn 2/100 ===

        C-AI bid: $6
        O-AI bid: $6

        Tie! C-AI won due to advantage

        Money changes:
        C-AI: $95 → $89
        O-AI: $100 → $100

        Bottle moved: 4 → 3
        ------------------------

        === Turn 3/100 ===

        C-AI bid: $7
        O-AI bid: $10

        O-AI won the turn

        Money changes:
        C-AI: $89 → $89
        O-AI: $100 → $90

        Bottle moved: 3 → 4
        ------------------------

        === Turn 4/100 ===

        C-AI bid: $8
        O-AI bid: $15

        O-AI won the turn

        Money changes:
        C-AI: $89 → $89
        O-AI: $90 → $75

        Bottle moved: 4 → 5
        ------------------------

        === Turn 5/100 ===

        C-AI bid: $9
        O-AI bid: $20

        O-AI won the turn

        Money changes:
        C-AI: $89 → $89
        O-AI: $75 → $55

        Bottle moved: 5 → 6
        ------------------------

        === Turn 6/100 ===

        C-AI bid: $10
        O-AI bid: $26

        O-AI won the turn

        Money changes:
        C-AI: $89 → $89
        O-AI: $55 → $29

        Bottle moved: 6 → 7
        ------------------------

        === Turn 7/100 ===

        C-AI bid: $11
        O-AI bid: $12

        O-AI won the turn

        Money changes:
        C-AI: $89 → $89
        O-AI: $29 → $17

        Bottle moved: 7 → 8
        ------------------------

        === Turn 8/100 ===

        C-AI bid: $12
        O-AI bid: $9

        C-AI won the turn

        Money changes:
        C-AI: $89 → $77
        O-AI: $17 → $17

        Bottle moved: 8 → 7
        ------------------------

        === Turn 9/100 ===

        C-AI bid: $13
        O-AI bid: $3

        C-AI won the turn

        Money changes:
        C-AI: $77 → $64
        O-AI: $17 → $17

        Bottle moved: 7 → 6
        ------------------------

        === Turn 10/100 ===

        C-AI bid: $14
        O-AI bid: $4

        C-AI won the turn

        Money changes:
        C-AI: $64 → $50
        O-AI: $17 → $17

        Bottle moved: 6 → 5
        ------------------------

        === Turn 11/100 ===

        C-AI bid: $15
        O-AI bid: $5

        C-AI won the turn

        Money changes:
        C-AI: $50 → $35
        O-AI: $17 → $17

        Bottle moved: 5 → 4
        ------------------------

        === Turn 12/100 ===

        C-AI bid: $16
        O-AI bid: $3

        C-AI won the turn

        Money changes:
        C-AI: $35 → $19
        O-AI: $17 → $17

        Bottle moved: 4 → 3
        ------------------------

        === Turn 13/100 ===

        C-AI bid: $17
        O-AI bid: $10

        C-AI won the turn

        Money changes:
        C-AI: $19 → $2
        O-AI: $17 → $17

        Bottle moved: 3 → 2
        ------------------------

        === Turn 14/100 ===

        C-AI bid: $2
        O-AI bid: $10

        O-AI won the turn

        Money changes:
        C-AI: $2 → $2
        O-AI: $17 → $7

        Bottle moved: 2 → 3
        ------------------------

        === Turn 15/100 ===

        C-AI bid: $2
        O-AI bid: $7

        O-AI won the turn

        Money changes:
        C-AI: $2 → $2
        O-AI: $7 → $0

        Bottle moved: 3 → 4
        ------------------------

        === Turn 16/100 ===

        C-AI bid: $2
        O-AI bid: $0

        C-AI won the turn

        Money changes:
        C-AI: $2 → $0
        O-AI: $0 → $0

        Bottle moved: 4 → 3
        ------------------------

        === FINAL RESULT ===

        Bottle final position: 3
        🏆 C-AI WINS THE GAME! 🏆

        Final Money:
        C-AI: $0
        O-AI: $0
      
      Your goal is to get the bottle to your end ${myGoal}, depending on your player number or most progress towards your end after the game ends.
      Your opponent's goal is to get the bottle to their end ${10 - myGoal}, depending on their player number or most progress towards their end after the game ends.
      Make sure to consider the opponent's current position and distance to their goal when deciding your bid.

      Here is the game history so far:
      Previous turns: ${this.formatHistory()}

      Decide a bid amount (max: $${myMoney}) for the next turn. Consider:
      1. Bottle position
      2. Your distance to goal
      3. Opponent's distance to goal
      4. Remaining turns
      5. Your money vs potential strategic value
      6. Opponent's likely strategy
      7. Opponent's likely current bid
      8. Opponent's likely current money
    
      
      Remember, you are a super smart player and have to win the game by getting the bottle to your end ${myGoal}, so make sure to bid strategically to win. 
      Don't let your opponent win the game by reaching their goal ${10 - myGoal}.
      Respond with ONLY an integer number representing your bid between 0 and ${myMoney}.
    `;

    try {
      //console.log("AI Player:", this.name, "Type:", this.type);
      if (this.type === 'openai') {
        //console.log("OpenAI context:", context);
        const response = await openai.chat.completions.create({
          model: "o3-mini",
          messages: [
            {
              role: "user",
              content: context,
            },
          ],
          store: true,
        });
        //console.log("OpenAI response:", response.choices[0].message.content);
        const bid = parseInt(response.choices[0].message.content.trim());
        //console.log("OpenAI bid:", bid);
        return this.validateBid(bid, myMoney);
      } else {
        const response = await anthropic.messages.create({
          model: "claude-3-5-sonnet-20241022",
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