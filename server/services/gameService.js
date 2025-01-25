const { broadcastAll } = require('../utils/websocket');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

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
        claude = new Anthropic({
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
            bid = await getOpenAIBid(game, player);
        } else if (player.aiType === 'claude' && claude) {
            bid = await getClaudeBid(game, player);
        } else {
            // Fallback to simple AI logic
            bid = getSimpleAIBid(game, player);
        }
        
        // Submit the bid
        if (game.placeBid) {
            game.placeBid(player.ws, bid);
        } else {
            player.submitBid(bid);
        }
    } catch (error) {
        console.error('Error in AI bid:', error);
        // Fallback to simple AI on error
        const bid = getSimpleAIBid(game, player);
        player.submitBid(bid);
    }
}

async function getOpenAIBid(game, player) {
    const isPlayer1 = game.players[0] === player;
    const goal = isPlayer1 ? 0 : 10;
    const position = game.scotchPosition;
    const money = player.money;
    const turnNumber = game.turnNumber;
    const maxTurns = game.maxTurns;
    
    const prompt = `You are playing a bidding game. The goal is to move a bottle to position ${goal} (current position: ${position}).
    You have $${money} left. This is turn ${turnNumber} of ${maxTurns}.
    What amount should you bid? Respond with just a number.`;
    
    const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [{
            role: "user",
            content: prompt
        }],
        max_tokens: 10,
        temperature: 0.7
    });
    
    const bidText = response.choices[0].message.content.trim();
    const bid = parseInt(bidText);
    
    // Validate and constrain the bid
    if (isNaN(bid) || bid < 0) return 0;
    if (bid > money) return money;
    return bid;
}

async function getClaudeBid(game, player) {
    try {
        const isPlayer1 = game.players[0] === player;
        const goal = isPlayer1 ? 0 : 10;
        const position = game.scotchPosition;
        const money = player.money;
        const turnNumber = game.turnNumber;
        const maxTurns = game.maxTurns;
        
        const prompt = `You are playing a bidding game. The goal is to move a bottle to position ${goal} (current position: ${position}).
        You have $${money} left. This is turn ${turnNumber} of ${maxTurns}.
        What amount should you bid? Respond with just a number.`;
        
        const response = await claude.messages.create({
            model: "claude-3-sonnet-20240229",
            max_tokens: 50,
            temperature: 0.7,
            messages: [{
                role: "user",
                content: prompt
            }]
        });

        const bidText = response.content[0].text;
        const bid = parseInt(bidText.match(/\d+/)[0]);
        
        // Validate and constrain the bid
        if (isNaN(bid) || bid < 0) return 0;
        if (bid > money) return money;
        return bid;
    } catch (error) {
        console.error('Error getting Claude bid:', error);
        return getSimpleAIBid(game, player);
    }
}

function getSimpleAIBid(game, player) {
    const isPlayer1 = game.players[0] === player;
    const position = game.scotchPosition;
    const money = player.money;
    
    // Simple strategy: bid more when closer to goal
    let bidPercentage;
    if (isPlayer1) {
        // Player 1 wants position 0
        bidPercentage = position / 10;
    } else {
        // Player 2 wants position 10
        bidPercentage = (10 - position) / 10;
    }
    
    // Add some randomness
    bidPercentage = bidPercentage * (0.8 + Math.random() * 0.4);
    
    // Calculate bid
    let bid = Math.floor(money * bidPercentage);
    
    // Ensure minimum bid of 1 if we have money
    if (bid === 0 && money > 0) bid = 1;
    
    return bid;
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