/**
 * client.js
 *
 * Implements:
 * 1) Player login + passcode or Audience join (no passcode).
 * 2) Show scotch image on canvas (use base64 or real .png).
 * 3) Show own money & last bid to the player after each turn.
 * 4) Show if the other player has submitted or not (BID_STATUS).
 * 5) 30-second timer is handled on server; we display forced 0 if it happens.
 * 6) If a player disconnects, the game ends for everyone.
 */

let ws;
let myPlayerName = null;
let loggedIn = false;
let isAudience = false;

// For hiding typed length:
let realBidValue = "";

// Track the scotch position for animation
let scotchPosition = 5;

// Turn-by-turn final data (for replay)
let finalTurnHistory = null;

// Add this at the top with other state variables
let gameState = {
  turnNumber: 0,
  maxTurns: 0,
  isGameOver: false,
  myMoney: 0,
  lastBid: null
};

// Add these as state variables at the top with others
let p1Name = "P1";
let p2Name = "P2";

// Add MAX_TURNS constant at the top of the file
const MAX_TURNS = 5;  // Match server's MAX_TURNS

// Add at the top with other state variables
let showBidsMode = false;

// Add to your existing state variables at the top
let lastRatingChanges = null;

// Add these constants at the top
const AI_NAMES = {
  CLAUDE: "Claude-AI",
  GPT4: "GPT4-AI"
};

//////////////////////////////////////////////////
// Setup Canvas & Scotch Image
//////////////////////////////////////////////////
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// You can also use an external scotch.png in /public
let scotchImg = new Image();
scotchImg.src = "./scotch.png";
scotchImg.onerror = () => {
  console.log("Image failed to load or is broken!");
};

scotchImg.onload = () => {
  // Draw once at load time
  console.log("Image loaded successfully.");
  drawBaseline(scotchPosition);
};

function drawBaseline(pos) {
  // Make sure canvas is visible
  if (canvas.style.display === 'none') {
    canvas.style.display = 'block';
  }
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const y = 100;
  
  // Draw main line thicker with better contrast
  ctx.strokeStyle = "#ffcc00";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(50, y);
  ctx.lineTo(550, y);
  ctx.stroke();

  // Draw position markers more prominently
  for (let i = 0; i <= 10; i++) {
    const x = posToX(i);
    
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x, y + 10);
    ctx.stroke();
    
    ctx.fillStyle = "#ffcc00";
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "center";
    ctx.fillText(i.toString(), x, y + 25);
    
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#ffcc00";
    ctx.fill();
  }

  // Draw Player 1 label and arrow (left side)
  ctx.fillStyle = "#ff3333"; // Red for Player 1
  ctx.font = "bold 16px Arial";
  ctx.textAlign = "center";
  // Draw name inside canvas bounds
  ctx.fillText(p1Name, 80, 50);
  
  // Draw arrow for Player 1's direction
  ctx.beginPath();
  ctx.moveTo(95, 60);
  ctx.lineTo(80, 75);
  ctx.lineTo(95, 90);
  ctx.strokeStyle = "#ff3333";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Draw Player 2 label and arrow (right side)
  ctx.fillStyle = "#33ff33"; // Green for Player 2
  ctx.font = "bold 16px Arial";
  ctx.textAlign = "center";
  // Draw name inside canvas bounds
  ctx.fillText(p2Name, 520, 50);
  
  // Draw arrow for Player 2's direction
  ctx.beginPath();
  ctx.moveTo(505, 60);
  ctx.lineTo(520, 75);
  ctx.lineTo(505, 90);
  ctx.strokeStyle = "#33ff33";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Highlight current position with contrasting color
  const currentX = posToX(pos);
  ctx.beginPath();
  ctx.arc(currentX, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = "#ff3333";
  ctx.strokeStyle = "#ffcc00";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();

  drawScotch(pos);
}

function posToX(pos) {
  // 0..10 => 50..550
  return 50 + 500 * (pos / 10);
}

function drawScotch(pos) {
  if (!scotchImg.complete) {
    // If image isn't loaded yet, retry in a moment
    setTimeout(() => drawScotch(pos), 100);
    return;
  }

  const x = posToX(pos);
  const y = 100;
  const w = 30;
  const h = 60;
  
  try {
    ctx.drawImage(scotchImg, x - w / 2, y - h + 10, w, h);
  } catch (err) {
    console.error("Error drawing scotch:", err);
  }
}

function animateScotchMove(oldPos, newPos, onComplete) {
  if (oldPos === newPos) {
    if (onComplete) onComplete();
    return;
  }

  const frames = 30;
  let current = 0;
  
  if (window.currentAnimation) {
    cancelAnimationFrame(window.currentAnimation);
  }

  const startTime = performance.now();
  const duration = 1000; // 1 second animation

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    const curPos = oldPos + (newPos - oldPos) * progress;
    drawBaseline(curPos);
    
    if (progress < 1) {
      window.currentAnimation = requestAnimationFrame(step);
    } else {
      window.currentAnimation = null;
      drawBaseline(newPos);
      if (onComplete) {
        onComplete();
      }
    }
  }

  window.currentAnimation = requestAnimationFrame(step);
}

//////////////////////////////////////////////////
// On page load
//////////////////////////////////////////////////
window.addEventListener("load", () => {
  // In case scotchImg wasn't loaded, we'll still attempt the baseline
  drawBaseline(scotchPosition);
  connectWebSocket();
  updateBidLabel = setupBidFieldMask();
  
  // Request initial leaderboard data
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "REQUEST_LEADERBOARD" }));
  }
});

//////////////////////////////////////////////////
// Connect WebSocket
//////////////////////////////////////////////////
function connectWebSocket() {
  if (ws) {
    ws.close();
  }

  // Handle both secure and non-secure connections
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    console.log("WebSocket connected");
    showStatus("Connected to game server");
  };
  
  ws.onmessage = (msgEvent) => {
    try {
      const data = JSON.parse(msgEvent.data);
      console.log("Received message:", data);  // Debug logging
      handleServerMessage(data);
    } catch (err) {
      console.error("Error handling message:", err);
      showStatus("Error processing server message");
    }
  };
  
  ws.onclose = () => {
    console.log("WebSocket disconnected");
    showStatus("Connection lost. Attempting to reconnect...");
    // Attempt to reconnect after 2 seconds
    setTimeout(connectWebSocket, 2000);
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    showStatus("Connection error occurred");
  };
}

function handleServerMessage(data) {
  switch (data.type) {
    // Player login error
    case "LOGIN_ERROR":
      document.getElementById("loginError").textContent = data.message;
      break;

    // Player login success
    case "LOGIN_SUCCESS":
      myPlayerName = data.playerName;
      loggedIn = true;
      isAudience = false;
      gameState.myMoney = data.money;
      showBidsMode = data.showBidsMode;
      
      // Disable the checkbox for second player
      const showBidsCheck = document.getElementById("showBidsCheck");
      if (!data.isFirstPlayer) {
        showBidsCheck.disabled = true;
        showBidsCheck.checked = showBidsMode;
        showBidsCheck.parentElement.style.opacity = "0.5";
        showBidsCheck.parentElement.title = "Only first player can set this option";
      }
      
      document.getElementById("loginPanel").style.display = "none";
      document.getElementById("audiencePanel").style.display = "none";
      document.getElementById("gamePanel").style.display = "block";
      
      // Update greeting message based on game mode
      const gameMode = document.querySelector('input[name="gameMode"]:checked')?.value;
      if (gameMode === 'ai_vs_ai') {
        document.getElementById("playerNameSpan").textContent = "AI Match (Spectator)";
      } else {
        document.getElementById("playerNameSpan").textContent = myPlayerName;
      }
      
      // Show initial money
      const myStatsDiv = document.getElementById("myStats");
      myStatsDiv.textContent = `Your Money: $${gameState.myMoney}  |  Last Bid: $0`;
      showStatus(`Logged in with $${gameState.myMoney}`);
      break;

    // Audience just joined
    case "AUDIENCE_OK":
      loggedIn = true;
      isAudience = true;
      document.getElementById("loginPanel").style.display = "none";
      document.getElementById("audiencePanel").style.display = "none";
      document.getElementById("gamePanel").style.display = "block";
      document.getElementById("playerNameSpan").textContent = "(Audience)";
      // Hide the bid input UI
      document.getElementById("bidInput").disabled = true;
      document.querySelector("#bidInput + button").disabled = true;
      showStatus("You are an Audience member. You can watch but not bid.");
      break;

    // A partial game state for new audience
    case "GAME_STATE":
      gameState.turnNumber = data.turnNumber;
      gameState.maxTurns = data.maxTurns;
      gameState.isGameOver = data.gameOver;
      scotchPosition = data.scotchPosition || 5;
      drawBaseline(scotchPosition);
      showStatus(`Turn ${data.turnNumber}/${data.maxTurns}${data.gameOver ? " - Game Over!" : ""}`);
      break;

    // Turn resolved => animate scotch
    case "TURN_RESOLVED":
      {
        const { scotchPosition: newPos, oldPosition, gameOver, turnNumber, maxTurns, winner, p1Bid, p2Bid } = data;
        gameState.turnNumber = turnNumber;
        gameState.maxTurns = maxTurns;
        gameState.isGameOver = gameOver;

        // Update turn counter in UI
        document.getElementById("currentTurn").textContent = turnNumber;
        document.getElementById("maxTurns").textContent = maxTurns;

        // Show bids if mode is enabled
        if (showBidsMode) {
          showStatus(`Turn ${turnNumber}/${maxTurns}: ${p1Name} bid $${p1Bid}, ${p2Name} bid $${p2Bid}`);
        }
        
        // Then show who won
        const winnerName = winner === 1 ? p1Name : p2Name;
        showStatus(`${winnerName} won the turn!`);
        
        requestAnimationFrame(() => {
          animateScotchMove(oldPosition, newPos, () => {
            scotchPosition = newPos;
            if (gameOver) {
              const finalWinner = scotchPosition <= 0 ? p1Name : 
                                scotchPosition >= 10 ? p2Name : 
                                p1Name;  // Default to p1 if max turns reached
              showStatus(`🏆 ${finalWinner} WINS THE GAME! 🏆`);
              showWinnerPopup(finalWinner);
            }
          });
        });
      }
      break;

    // This server->client message means forced 0 for missing player
    case "FORCED_BID":
      showStatus(data.message);
      break;

    // Private update to me about my money + bid
    case "PLAYER_UPDATE":
      if (!isAudience) {
        gameState.myMoney = data.money;
        gameState.lastBid = data.lastBid;
        
        const myStatsDiv = document.getElementById("myStats");
        myStatsDiv.textContent = `Your Money: $${data.money}  |  Last Bid: $${data.lastBid || 0}`;
        
        // Update the bid input label with new max
        if (updateBidLabel) updateBidLabel();
      }
      break;

    // Show who has/have not submitted
    case "BID_STATUS":
      p1Name = data.p1Name;
      p2Name = data.p2Name;
      updateBidStatus(data);
      // Add turn number if available
      if (data.turnNumber) {
        showStatus(`Turn ${data.turnNumber}: Waiting for players to submit bids...`);
      }
      break;

    // Full game over with replay info
    case "GAME_OVER":
      finalTurnHistory = data.turnHistory;
      gameState.finalState = data.finalState; // Store final state for replay
      showStatus("Game Over!");
      document.getElementById("replaySection").style.display = "block";
      
      // Handle rating changes
      if (data.ratingChanges) {
        lastRatingChanges = data.ratingChanges;
        const winner = data.ratingChanges.winner;
        const loser = data.ratingChanges.loser;
        
        // Show rating changes in status
        showStatus(`🏆 ${winner.name} wins!`);
        showStatus(`Rating changes:`);
        showStatus(`${winner.name}: +${winner.ratingChange} (${Math.round(winner.newRating)})`);
        showStatus(`${loser.name}: ${loser.ratingChange} (${Math.round(loser.newRating)})`);
      }
      
      // If there's a disconnect field, show that
      if (data.disconnect) {
        showStatus(`Player [${data.disconnect}] disconnected. Game ended.`);
      }
      break;

    // Bid error
    case "BID_ERROR":
      showStatus(`Error: ${data.message}`);
      break;

    case "LEADERBOARD_UPDATE":
      updateLeaderboardDisplay(data.leaderboard);
      break;

    default:
      console.log("Unknown message:", data);
      break;
  }
}

//////////////////////////////////////////////////
// UI for login
//////////////////////////////////////////////////
function loginAsPlayer() {
  const name = document.getElementById("nameInput").value.trim();
  const pass = document.getElementById("passInput").value.trim();
  const showBidsCheck = document.getElementById("showBidsCheck");
  const gameMode = document.querySelector('input[name="gameMode"]:checked').value;
  
  document.getElementById("loginError").textContent = "";
  
  if (!name || !pass) {
    document.getElementById("loginError").textContent = "Enter name + passcode.";
    return;
  }
  
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    document.getElementById("loginError").textContent = "Connection not ready. Please try again in a moment.";
    return;
  }

  // Handle AI vs AI match
  if (gameMode === 'ai_vs_ai') {
    ws.send(JSON.stringify({
      type: "LOGIN",
      playerName: AI_NAMES.CLAUDE,
      passcode: pass,
      showBids: showBidsCheck.checked,
      isAI: true,
      aiType: 'claude'
    }));

    setTimeout(() => {
      ws.send(JSON.stringify({
        type: "LOGIN",
        playerName: AI_NAMES.GPT4,
        passcode: pass,
        isAI: true,
        aiType: 'openai'
      }));
    }, 500);

    // Join as audience to watch
    setTimeout(() => {
      joinAsAudience();
    }, 1000);
    
    return;
  }

  // Handle human vs AI or human vs human
  ws.send(JSON.stringify({
    type: "LOGIN",
    playerName: name,
    passcode: pass,
    showBids: showBidsCheck.checked,
    isAI: false
  }));

  // If playing against AI, automatically log in the AI opponent
  if (gameMode !== 'human') {
    setTimeout(() => {
      ws.send(JSON.stringify({
        type: "LOGIN",
        playerName: gameMode === 'claude' ? AI_NAMES.CLAUDE : AI_NAMES.GPT4,
        passcode: pass,
        isAI: true,
        aiType: gameMode === 'claude' ? 'claude' : 'openai'
      }));
    }, 500);
  }
}

function joinAsAudience() {
  ws.send(JSON.stringify({ type: "AUDIENCE_JOIN" }));
}

//////////////////////////////////////////////////
// Bidding
//////////////////////////////////////////////////
function setupBidFieldMask() {
  const bidInput = document.getElementById("bidInput");
  const bidLabel = document.querySelector('label[for="bidInput"]') || bidInput.previousElementSibling;
  
  bidInput.value = "";
  realBidValue = "";

  // Update the label to show max $100 at start or current money during game
  function updateBidLabel() {
    const maxBid = gameState.turnNumber === 0 ? 100 : gameState.myMoney;
    bidLabel.textContent = `Your Bid (max $${maxBid}): `;
  }
  updateBidLabel();

  bidInput.addEventListener("input", (e) => {
    const newVal = e.target.value;
    // Only allow numbers
    const numericVal = newVal.replace(/[^0-9]/g, '');
    
    if (numericVal.length > 0) {
      realBidValue = numericVal;
      // Show the actual number instead of asterisks
      e.target.value = numericVal;
    } else {
      realBidValue = "";
      e.target.value = "";
    }
  });

  // Add enter key support
  bidInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      submitBid();
    }
  });

  // Update label when money changes
  return updateBidLabel;
}

// Store the update function
let updateBidLabel;

function submitBid() {
  if (!loggedIn || isAudience) return;
  
  const bidInt = parseInt(realBidValue || "0", 10);
  
  // Validate bid against current money
  if (bidInt > gameState.myMoney) {
    showStatus(`Error: Bid ($${bidInt}) exceeds your money ($${gameState.myMoney})`);
    return;
  }
  
  // Only show submission message, not result
  showStatus(`Bid submitted: $${bidInt}`);
  
  ws.send(
    JSON.stringify({
      type: "SUBMIT_BID",
      playerName: myPlayerName,
      bid: bidInt,
    })
  );
  realBidValue = "";
  document.getElementById("bidInput").value = "";
}

//////////////////////////////////////////////////
// Show status text
//////////////////////////////////////////////////
function showStatus(msg) {
  const s = document.getElementById("statusArea");
  // Limit to last 5 messages and auto-scroll
  const messages = s.textContent.split('\n').slice(-4);
  messages.push(msg);
  s.textContent = messages.join('\n');
  s.scrollTop = s.scrollHeight;
  
  // Also log to console for debugging
  console.log("Status:", msg);
}

//////////////////////////////////////////////////
// Show if other player has submitted
//////////////////////////////////////////////////
function updateBidStatus(data) {
  if (!loggedIn || isAudience) {
    showStatus(`Bid Status - ${data.p1Name}: ${data.p1Submitted ? "✓" : "..."}, ${data.p2Name}: ${data.p2Submitted ? "✓" : "..."}`);
    return;
  }

  let me, other;
  if (data.p1Name === myPlayerName) {
    me = { name: data.p1Name, submitted: data.p1Submitted };
    other = { name: data.p2Name, submitted: data.p2Submitted };
  } else {
    me = { name: data.p2Name, submitted: data.p2Submitted };
    other = { name: data.p1Name, submitted: data.p1Submitted };
  }

  const meSubText = me.submitted ? `✓ ${me.name} has submitted` : `❌ ${me.name} has NOT submitted`;
  const otherSubText = other.submitted ? `✓ ${other.name} has submitted` : `❌ ${other.name} has NOT submitted`;

  document.getElementById("otherPlayerStatus").textContent = `${meSubText} | ${otherSubText}`;
}

//////////////////////////////////////////////////
// Replay
//////////////////////////////////////////////////
let replayIndex = 0;
function startReplay() {
  const rm = document.getElementById("replayMessages");
  if (!finalTurnHistory) {
    rm.textContent = "No turn history?!";
    return;
  }
  replayIndex = 0;
  rm.textContent = "=== GAME REPLAY ===\n";
  replayNextTurn();
}

function replayNextTurn() {
  const rm = document.getElementById("replayMessages");
  if (replayIndex >= finalTurnHistory.length) {
    // Get final state from game over data
    const finalState = gameState.finalState;
    if (!finalState) {
      console.error("Missing final state in game over data");
      return;
    }
    
    rm.textContent += `\n=== FINAL RESULT ===\n\n`;
    rm.textContent += `Bottle final position: ${finalState.newPosition}\n`;
    rm.textContent += `🏆 ${finalState.finalWinner} WINS THE GAME! 🏆\n\n`;
    rm.textContent += `Final Money:\n`;
    rm.textContent += `${finalState.p1Name}: $${finalState.p1MoneyAfter}\n`;
    rm.textContent += `${finalState.p2Name}: $${finalState.p2MoneyAfter}\n`;
    return;
  }
  
  const turnData = finalTurnHistory[replayIndex];

  rm.textContent += `\n=== Turn ${turnData.turnNumber}/${MAX_TURNS} ===\n\n`;
  
  // Show bids and money changes
  rm.textContent += `${turnData.p1Name} bid: $${turnData.p1Bid}\n`;
  rm.textContent += `${turnData.p2Name} bid: $${turnData.p2Bid}\n\n`;
  
  // Show who won and money results
  const winnerName = turnData.winner === 1 ? turnData.p1Name : turnData.p2Name;
  if (turnData.tieUsed) {
    rm.textContent += `Tie! ${winnerName} won due to advantage\n\n`;
  } else {
    rm.textContent += `${winnerName} won the turn\n\n`;
  }
  
  // Show money changes
  rm.textContent += `Money changes:\n`;
  rm.textContent += `${turnData.p1Name}: $${turnData.p1MoneyBefore} → $${turnData.p1MoneyAfter}\n`;
  rm.textContent += `${turnData.p2Name}: $${turnData.p2MoneyBefore} → $${turnData.p2MoneyAfter}\n\n`;
  
  rm.textContent += `Bottle moved: ${turnData.oldPosition} → ${turnData.newPosition}\n`;
  rm.textContent += `------------------------\n`;

  replayIndex++;
  animateScotchMove(turnData.oldPosition, turnData.newPosition, () => {
    setTimeout(replayNextTurn, 1000);
  });
  
  // Auto-scroll to bottom
  rm.scrollTop = rm.scrollHeight;
}

// Add this function for the winner popup
function showWinnerPopup(winnerName) {
  // Create popup elements
  const popup = document.createElement('div');
  popup.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: linear-gradient(135deg, #ffcc00 0%, #ff9900 100%);
    padding: 30px;
    border-radius: 15px;
    box-shadow: 0 0 20px rgba(0,0,0,0.5);
    z-index: 1000;
    text-align: center;
    font-family: 'Press Start 2P', monospace;
    color: #000;
    animation: popupAppear 0.5s ease-out;
  `;

  const trophy = document.createElement('div');
  trophy.style.cssText = `
    font-size: 50px;
    margin-bottom: 20px;
  `;
  trophy.textContent = '🏆';

  const text = document.createElement('div');
  text.style.cssText = `
    font-size: 24px;
    margin-bottom: 20px;
    white-space: nowrap;
  `;
  text.textContent = `${winnerName} WINS!`;

  const closeButton = document.createElement('button');
  closeButton.textContent = 'Close';
  closeButton.style.cssText = `
    font-family: 'Press Start 2P', monospace;
    padding: 10px 20px;
    cursor: pointer;
    background: #fff;
    border: 2px solid #000;
    border-radius: 5px;
  `;
  closeButton.onclick = () => document.body.removeChild(popup);

  // Add CSS animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes popupAppear {
      0% { transform: translate(-50%, -50%) scale(0); }
      70% { transform: translate(-50%, -50%) scale(1.1); }
      100% { transform: translate(-50%, -50%) scale(1); }
    }
  `;
  document.head.appendChild(style);

  // Assemble and show popup
  popup.appendChild(trophy);
  popup.appendChild(text);
  popup.appendChild(closeButton);
  document.body.appendChild(popup);

  // Auto-close after 5 seconds
  setTimeout(() => {
    if (document.body.contains(popup)) {
      document.body.removeChild(popup);
    }
  }, 5000);
}

// Add this function to update the leaderboard display
function updateLeaderboardDisplay(leaderboard) {
  const tbody = document.querySelector("#leaderboardTable tbody");
  tbody.innerHTML = "";
  
  leaderboard.forEach((player, index) => {
    const row = document.createElement("tr");
    
    // Add rank with medal for top 3
    const rankCell = document.createElement("td");
    let rankText = (index + 1).toString();
    if (index === 0) rankText = "🥇 " + rankText;
    else if (index === 1) rankText = "🥈 " + rankText;
    else if (index === 2) rankText = "🥉 " + rankText;
    rankCell.textContent = rankText;
    rankCell.className = `player-rank-${index + 1}`;
    
    // Add player name
    const nameCell = document.createElement("td");
    nameCell.textContent = player.name;
    if (player.name === myPlayerName) {
      nameCell.style.fontWeight = "bold";
    }
    
    // Add rating with change if available
    const ratingCell = document.createElement("td");
    ratingCell.textContent = Math.round(player.rating);
    if (lastRatingChanges) {
      if (player.name === lastRatingChanges.winner?.name) {
        const change = document.createElement("span");
        change.className = "rating-change rating-up";
        change.textContent = ` (+${lastRatingChanges.winner.ratingChange})`;
        ratingCell.appendChild(change);
      } else if (player.name === lastRatingChanges.loser?.name) {
        const change = document.createElement("span");
        change.className = "rating-change rating-down";
        change.textContent = ` (${lastRatingChanges.loser.ratingChange})`;
        ratingCell.appendChild(change);
      }
    }
    
    // Add win/loss record
    const recordCell = document.createElement("td");
    recordCell.textContent = `${player.wins}/${player.losses}`;
    
    // Add games played
    const gamesCell = document.createElement("td");
    gamesCell.textContent = player.gamesPlayed;
    
    row.appendChild(rankCell);
    row.appendChild(nameCell);
    row.appendChild(ratingCell);
    row.appendChild(recordCell);
    row.appendChild(gamesCell);
    
    tbody.appendChild(row);
  });
}
