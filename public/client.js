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

// Player class is loaded globally from player.js
/* global Player */

let ws;
let myPlayer = null;
let loggedIn = false;
let isAudience = false;

// For hiding typed length:
let realBidValue = "";

// Track the scotch position for animation
let scotchPosition = 5;

// Turn-by-turn final data (for replay)
let finalTurnHistory = null;

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
  } else {
    // If websocket isn't ready, wait and try again
    setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "REQUEST_LEADERBOARD" }));
      }
    }, 1000);
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
    
    // Request leaderboard data on connection
    requestLeaderboard();
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
      const isHumanLogin = !data.isAI;
      
      if (isHumanLogin) {
        myPlayer = new Player(data.playerName);
        myPlayer.updateGameState({
          money: data.money,
          turnNumber: 1,
          maxTurns: MAX_TURNS
        });
        
        loggedIn = true;
        isAudience = false;
        showBidsMode = data.showBidsMode;
        
        // Update UI
        document.getElementById("loginPanel").style.display = "none";
        document.getElementById("audiencePanel").style.display = "none";
        document.getElementById("gamePanel").style.display = "block";
        document.getElementById("playerNameSpan").textContent = myPlayer.name;
        
        updatePlayerStats();
        updateTurnDisplay();
        updateBidInput();
        
        showStatus(`Logged in with $${myPlayer.gameState.money}`);
      } else {
        // For AI logins, store the player names
        if (data.playerName === AI_NAMES.CLAUDE) {
          p1Name = data.playerName;
        } else if (data.playerName === AI_NAMES.GPT4) {
          p2Name = data.playerName;
        }
        // Redraw the canvas to show updated names
        drawBaseline(scotchPosition);
      }
      console.log("Login success:", { myPlayerName: myPlayer.name, p1Name, p2Name, gameState: myPlayer.gameState });
      
      // Handle checkbox state
      const showBidsCheck = document.getElementById("showBidsCheck");
      if (!data.isFirstPlayer) {
        showBidsCheck.disabled = true;
        showBidsCheck.checked = showBidsMode;
        showBidsCheck.parentElement.style.opacity = "0.5";
        showBidsCheck.parentElement.title = "Only first player can set this option";
      }
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
      if (!isAudience) {
        myPlayer.updateGameState({
          turnNumber: data.turnNumber,
          maxTurns: data.maxTurns,
          isGameOver: data.gameOver,
          money: data.money,
          lastBid: data.lastBid
        });
      }
      scotchPosition = data.scotchPosition || 5;
      drawBaseline(scotchPosition);
      showStatus(`Turn ${data.turnNumber}/${data.maxTurns}${data.gameOver ? " - Game Over!" : ""}`);
      break;

    // Turn resolved => animate scotch
    case "TURN_RESOLVED":
      console.log("Turn resolved:", data);
      if (!isAudience && myPlayer) {
        myPlayer.updateGameState({
          turnNumber: data.turnNumber,
          maxTurns: data.maxTurns,
          money: data.money,
          lastBid: data.lastBid
        });
      }
      const oldPos = scotchPosition;
      scotchPosition = data.scotchPosition;
      
      // Update turn display
      const turnDisplay = document.getElementById("turnDisplay");
      if (turnDisplay) {
        turnDisplay.textContent = `Turn ${data.turnNumber} of ${data.maxTurns}`;
      }

      // Show turn result in status
      const winnerName = data.winner === 1 ? p1Name : p2Name;
      if (data.tieUsed) {
        showStatus(`Tie! ${winnerName} won due to advantage`);
      } else {
        showStatus(`${winnerName} won the turn!`);
      }

      // Show bid information if enabled
      if (showBidsMode) {
        showStatus(`${p1Name} bid: $${data.p1Bid}, ${p2Name} bid: $${data.p2Bid}`);
      }
      
      animateScotchMove(oldPos, scotchPosition, () => {
        if (data.gameOver && !isAudience && myPlayer) {
          myPlayer.updateGameState({
            isGameOver: true,
            money: data.money,
            lastBid: data.lastBid
          });
        }
      });
      break;

    // This server->client message means forced 0 for missing player
    case "FORCED_BID":
      showStatus(data.message);
      break;

    // Private update to me about my money + bid
    case "PLAYER_UPDATE":
      if (myPlayer && !isAudience) {
        myPlayer.updateGameState({
          money: data.money,
          lastBid: data.lastBid
        });
        updatePlayerStats();
        updateBidInput();
      }
      break;

    // Show who has/have not submitted
    case "BID_STATUS":
      console.log("Bid status:", data);
      const p1Status = data.p1Submitted ? "✓" : "❌";
      const p2Status = data.p2Submitted ? "✓" : "❌";
      
      // Update player names if provided, using defaults if undefined
      p1Name = data.p1Name || "Player 1";
      p2Name = data.p2Name || "Player 2";
      
      // Only show status for the current player and their opponent
      if (isAudience) {
        // Only show turn number if available
        const turnInfo = data.turnNumber ? ` - Turn ${data.turnNumber}/${MAX_TURNS}` : '';
        showStatus(`${p1Name} vs ${p2Name}${turnInfo}`);
        showStatus(`${p1Status} ${p1Name} ${data.p1Submitted ? "has submitted" : "waiting"} | ${p2Status} ${p2Name} ${data.p2Submitted ? "has submitted" : "waiting"}`);
      } else if (myPlayer && myPlayer.name === p1Name) {
        showStatus(`${p1Status} You have ${data.p1Submitted ? "" : "NOT "}submitted | ${p2Status} ${p2Name} has ${data.p2Submitted ? "" : "NOT "}submitted`);
      } else if (myPlayer && myPlayer.name === p2Name) {
        showStatus(`${p1Status} ${p1Name} has ${data.p1Submitted ? "" : "NOT "}submitted | ${p2Status} You have ${data.p2Submitted ? "" : "NOT "}submitted`);
      }

      // Redraw canvas to show updated names
      drawBaseline(scotchPosition);
      break;

    // Full game over with replay info
    case "GAME_OVER":
      finalTurnHistory = data.turnHistory;
      if (!isAudience && myPlayer) {
        myPlayer.updateGameState({
          finalState: data.finalState,
          isGameOver: true,
          money: data.finalState[myPlayer.name === data.finalState.p1Name ? 'p1MoneyAfter' : 'p2MoneyAfter']
        });
      }
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

        // Always show winner popup, even in AI vs AI mode
        showWinnerPopup(winner.name);
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

function updatePlayerStats() {
  const myStatsDiv = document.getElementById("myStats");
  if (myStatsDiv && myPlayer) {
    myStatsDiv.textContent = `Your Money: $${myPlayer.gameState.money} | Last Bid: $${myPlayer.gameState.lastBid || 0}`;
  }
}

function updateTurnDisplay() {
  const turnDisplay = document.getElementById("turnDisplay");
  if (turnDisplay && myPlayer) {
    turnDisplay.textContent = `Turn ${myPlayer.gameState.turnNumber} of ${MAX_TURNS}`;
  }
}

function updateBidInput() {
  const bidInput = document.getElementById("bidInput");
  if (bidInput && myPlayer) {
    bidInput.max = myPlayer.gameState.money;
    const bidLabel = document.querySelector('label[for="bidInput"]');
    if (bidLabel) {
      bidLabel.textContent = `Your Bid (max $${myPlayer.gameState.money}): `;
    }
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

  // For human vs AI or human vs human, always log in human first
  const humanLogin = {
    type: "LOGIN",
    playerName: name,
    passcode: pass,
    showBids: showBidsCheck.checked,
    isAI: false,
    isFirstPlayer: true
  };

  // Send human login first
  ws.send(JSON.stringify(humanLogin));

  // If playing against AI, log in AI after human login success
  if (gameMode !== 'human') {
    // Store AI login details to be sent after human login success
    window.pendingAILogin = {
      type: "LOGIN",
      playerName: gameMode === 'claude' ? AI_NAMES.CLAUDE : AI_NAMES.GPT4,
      passcode: pass,
      isAI: true,
      aiType: gameMode === 'claude' ? 'claude' : 'openai'
    };
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
    const maxBid = myPlayer.gameState.money;
    bidLabel.textContent = `Your Bid (max $${maxBid}): `;
    bidInput.max = maxBid;
  }
  updateBidLabel();

  bidInput.addEventListener("input", (e) => {
    const newVal = e.target.value;
    // Only allow numbers
    const numericVal = newVal.replace(/[^0-9]/g, '');
    
    if (numericVal.length > 0) {
      const maxBid = myPlayer.gameState.money;
      const validatedBid = Math.min(parseInt(numericVal), maxBid);
      realBidValue = validatedBid.toString();
      e.target.value = validatedBid.toString();
      console.log("Bid input:", { value: validatedBid, maxBid, money: myPlayer.gameState.money });
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

  return updateBidLabel;
}

function submitBid() {
  if (!loggedIn || isAudience || !myPlayer) return;
  
  const bidInt = parseInt(realBidValue || "0", 10);
  
  try {
    myPlayer.submitBid(bidInt);
    
    ws.send(
      JSON.stringify({
        type: "SUBMIT_BID",
        playerName: myPlayer.name,
        bid: bidInt
      })
    );
    
    showStatus(`Bid submitted: $${bidInt}`);
    realBidValue = "";
    document.getElementById("bidInput").value = "";
  } catch (error) {
    showStatus(`Error: ${error.message}`);
  }
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
    const finalState = myPlayer.gameState.finalState;
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

// Update leaderboard display function
function updateLeaderboardDisplay(leaderboard) {
  const tbody = document.querySelector("#leaderboardTable tbody");
  if (!tbody) return; // Guard against missing table
  
  tbody.innerHTML = "";
  
  // Sort leaderboard by rating
  const sortedLeaderboard = [...leaderboard].sort((a, b) => b.rating - a.rating);
  
  sortedLeaderboard.forEach((player, index) => {
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
    if (!isAudience && myPlayer && player.name === myPlayer.name) {
      nameCell.style.fontWeight = "bold";
      nameCell.style.color = "#ffcc00";
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
    
    // Add win rate percentage if they've played games
    const winRateCell = document.createElement("td");
    if (player.gamesPlayed > 0) {
      const winRate = (player.wins / player.gamesPlayed * 100).toFixed(1);
      winRateCell.textContent = `${winRate}%`;
    } else {
      winRateCell.textContent = "-";
    }
    
    row.appendChild(rankCell);
    row.appendChild(nameCell);
    row.appendChild(ratingCell);
    row.appendChild(recordCell);
    row.appendChild(gamesCell);
    row.appendChild(winRateCell);
    
    tbody.appendChild(row);
  });
}

// Add this function to request leaderboard data
function requestLeaderboard() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "REQUEST_LEADERBOARD" }));
  }
}