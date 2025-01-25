const { broadcastAll } = require('../utils/websocket');
const OpenAI = require('openai');
const { Claude } = require('@anthropic-ai/sdk');

// Initialize AI clients
let openai;
let claude;

try {
    if (process.env.OPENAI_API_KEY) {
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
    }
    
    if (process.env.ANTHROPIC_API_KEY) {
        claude = new Claude({
            apiKey: process.env.ANTHROPIC_API_KEY
        });
    }
} catch (error) {
    console.warn('Failed to initialize AI clients:', error);
}

async function handleAIBid(game, player) {
    try {
        let bid = 0;

        if (player.aiType === 'openai' && openai) {
            bid = await getGPT4Bid(game, player);
        } else if (player.aiType === 'claude' && claude) {
            bid = await getClaudeBid(game, player);
        } else {
            // Fallback to simple strategy
            bid = getSimpleAIBid(game, player);
        }

        // Place the bid
        if (typeof game.placeBid === 'function') {
            game.placeBid(player, bid);
        } else if (player.submitBid) {
            player.submitBid(bid);
        }
        
        return bid;
    } catch (error) {
        console.error('Error in AI bid:', error);
        // Fallback to simple strategy on error
        const bid = getSimpleAIBid(game, player);
        if (typeof game.placeBid === 'function') {
            game.placeBid(player, bid);
        } else if (player.submitBid) {
            player.submitBid(bid);
        }
        return bid;
    }
}

function getSimpleAIBid(game, player) {
    const { money } = player;
    const { bottlePosition, currentTurn, maxTurns } = game;
    
    // Calculate how far we are from our goal
    const isPlayer1 = game.players[0] === player;
    const goal = isPlayer1 ? 0 : 10;
    const distanceToGoal = Math.abs(bottlePosition - goal);
    
    // Calculate turns remaining
    const turnsLeft = maxTurns - currentTurn + 1;
    
    // If we can win in the remaining turns, bid more aggressively
    if (distanceToGoal <= turnsLeft) {
        return Math.min(money, Math.floor(money * 0.4));
    }
    
    // Otherwise bid conservatively
    return Math.min(money, Math.floor(money * 0.2));
}

async function getGPT4Bid(game, player) {
    try {
        const prompt = createBidPrompt(game, player);
        
        const response = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [{
                role: "system",
                content: "You are an AI playing a scotch auction game. Your goal is to determine the optimal bid amount."
            }, {
                role: "user",
                content: prompt
            }],
            temperature: 0.7,
            max_tokens: 50
        });

        const bidText = response.choices[0].message.content;
        const bid = parseInt(bidText.match(/\d+/)[0]);
        return Math.min(bid, player.money);
    } catch (error) {
        console.error('Error getting GPT-4 bid:', error);
        return getSimpleAIBid(game, player);
    }
}

async function getClaudeBid(game, player) {
    try {
        const prompt = createBidPrompt(game, player);
        
        const response = await claude.complete({
            prompt: `\n\nHuman: ${prompt}\n\nAssistant: Let me analyze the game state and determine the optimal bid. Based on the current position, money available, and turns remaining, I recommend bidding`,
            max_tokens: 50,
            temperature: 0.7
        });

        const bidText = response.completion;
        const bid = parseInt(bidText.match(/\d+/)[0]);
        return Math.min(bid, player.money);
    } catch (error) {
        console.error('Error getting Claude bid:', error);
        return getSimpleAIBid(game, player);
    }
}

function createBidPrompt(game, player) {
    const isPlayer1 = game.players[0] === player;
    const goal = isPlayer1 ? 0 : 10;
    
    return `
Current game state:
- You are Player ${isPlayer1 ? '1' : '2'}
- Your goal is position ${goal}
- Bottle is at position ${game.bottlePosition}
- You have $${player.money}
- Current turn: ${game.currentTurn}/${game.maxTurns}
- Your bid history: ${player.bidHistory.join(', ')}

What amount should you bid? Respond with just a number.`;
}

async function resolveTurn(game) {
  const p1Bid = game.player1.currentBid;
  const p2Bid = game.player2.currentBid;
  
  // Record turn history
  const turnData = {
    turn: game.currentTurn + 1,
    p1Name: game.player1.name,
    p2Name: game.player2.name,
    p1Bid,
    p2Bid,
    p1MoneyBefore: game.player1.money,
    p2MoneyBefore: game.player2.money,
    oldPosition: game.scotchPosition
  };

  // Update scotch position based on bids
  if (p1Bid > p2Bid) {
    game.scotchPosition = Math.max(0, game.scotchPosition - 1);
    turnData.winner = 1;
  } else if (p2Bid > p1Bid) {
    game.scotchPosition = Math.min(10, game.scotchPosition + 1);
    turnData.winner = 2;
  } else {
    // Tie - use first player advantage
    if (game.player1.isFirstPlayer) {
      game.scotchPosition = Math.max(0, game.scotchPosition - 1);
      turnData.winner = 1;
    } else {
      game.scotchPosition = Math.min(10, game.scotchPosition + 1);
      turnData.winner = 2;
    }
    turnData.tieUsed = true;
  }
  
  // Update player money
  game.player1.updateMoney(-p1Bid);
  game.player2.updateMoney(-p2Bid);
  
  turnData.p1MoneyAfter = game.player1.money;
  turnData.p2MoneyAfter = game.player2.money;
  turnData.newPosition = game.scotchPosition;
  
  game.turnHistory.push(turnData);
  
  // Reset bids
  game.player1.bidSubmitted = false;
  game.player2.bidSubmitted = false;
  game.player1.currentBid = null;
  game.player2.currentBid = null;
  
  game.currentTurn++;

  // Broadcast turn resolution
  broadcastAll(game.wss, {
    type: 'TURN_RESOLVED',
    turnNumber: game.currentTurn,
    maxTurns: game.MAX_TURNS,
    scotchPosition: game.scotchPosition,
    winner: turnData.winner,
    tieUsed: turnData.tieUsed,
    p1Bid,
    p2Bid,
    gameOver: game.currentTurn >= game.MAX_TURNS || game.scotchPosition === 0 || game.scotchPosition === 10
  });

  // Check for game end
  if (game.currentTurn >= game.MAX_TURNS || game.scotchPosition === 0 || game.scotchPosition === 10) {
    await handleGameOver(game);
  }
}

async function handleGameOver(game) {
  game.status = 'finished';
  
  // Determine winner
  let winner;
  if (game.scotchPosition < 5) {
    winner = game.player1;
  } else if (game.scotchPosition > 5) {
    winner = game.player2;
  } else {
    // If tied at position 5, player with more money wins
    if (game.player1.money > game.player2.money) {
      winner = game.player1;
    } else if (game.player2.money > game.player1.money) {
      winner = game.player2;
    }
  }

  const finalState = {
    p1Name: game.player1.name,
    p2Name: game.player2.name,
    p1MoneyAfter: game.player1.money,
    p2MoneyAfter: game.player2.money,
    newPosition: game.scotchPosition,
    finalWinner: winner ? winner.name : 'Tie'
  };

  // Broadcast game over
  broadcastAll(game.wss, {
    type: 'GAME_OVER',
    turnHistory: game.turnHistory,
    finalState,
    ratingChanges: winner ? {
      winner: {
        name: winner.name,
        ratingChange: 32,
        newRating: winner.rating + 32
      },
      loser: {
        name: winner === game.player1 ? game.player2.name : game.player1.name,
        ratingChange: -32,
        newRating: (winner === game.player1 ? game.player2 : game.player1).rating - 32
      }
    } : null
  });
}

module.exports = {
  handleAIBid,
  resolveTurn,
  handleGameOver
}; 