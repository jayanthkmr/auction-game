const { sendMessage, broadcastAll, broadcastBidStatus } = require('../utils/websocket');

async function handleAIBid(game, player) {
  if (!player.isAI) return;

  try {
    const bid = await player.decideBid(game);
    player.submitBid(bid);
    broadcastBidStatus(game.wss, game);
  } catch (error) {
    console.error(`Error getting AI bid: ${error}`);
    // Use fallback strategy
    const fallbackBid = Math.floor(Math.random() * (player.money + 1));
    player.submitBid(fallbackBid);
    broadcastBidStatus(game.wss, game);
  }
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