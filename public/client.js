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

// Initialize WebSocket and player state
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

// WebSocket connection
let gameState = {
    currentTurn: 1,
    maxTurns: 5,
    myMoney: 100,
    bottlePosition: 5,
    playerNumber: null,
    playerName: '',
    isSpectator: false,
    showBids: false,
    gameMode: 'human'
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

// Draw baseline on canvas
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
  drawPlayerLabel(p1Name, 80, 50, true);
  
  // Draw Player 2 label and arrow (right side)
  drawPlayerLabel(p2Name, 520, 50, false);

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

function drawPlayerLabel(name, x, y, isPlayer1) {
  ctx.fillStyle = isPlayer1 ? "#ff3333" : "#33ff33";
  ctx.font = "bold 16px Arial";
  ctx.textAlign = "center";
  ctx.fillText(name, x, y);
  
  // Draw arrow
  ctx.beginPath();
  if (isPlayer1) {
    ctx.moveTo(x + 15, y + 10);
    ctx.lineTo(x, y + 25);
    ctx.lineTo(x + 15, y + 40);
  } else {
    ctx.moveTo(x - 15, y + 10);
    ctx.lineTo(x, y + 25);
    ctx.lineTo(x - 15, y + 40);
  }
  ctx.strokeStyle = isPlayer1 ? "#ff3333" : "#33ff33";
  ctx.lineWidth = 2;
  ctx.stroke();
}

// Convert position to X coordinate
function posToX(pos) {
  // 0..10 => 50..550
  return 50 + 500 * (pos / 10);
}

// Draw scotch image on canvas
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

// Animate scotch movement
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

// Connect to WebSocket server
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

// Handle messages from server
function handleServerMessage(data) {
  switch (data.type) {
    case 'ERROR':
      showError(data.message);
      break;

    case 'LOGIN_SUCCESS':
      handleLoginSuccess(data);
      break;

    case 'AUDIENCE_OK':
      handleAudienceJoin();
      break;

    case 'GAME_STATE':
      handleGameState(data);
      break;

    case 'TURN_RESOLVED':
      handleTurnResolution(data);
      break;

    case 'BID_STATUS':
      handleBidStatus(data);
      break;

    case 'GAME_OVER':
      handleGameOver(data);
      break;

    case 'LEADERBOARD_UPDATE':
      updateLeaderboard(data.leaderboard);
      break;

    default:
      console.warn('Unknown message type:', data);
      break;
  }
}

function handleLoginSuccess(data) {
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

    // If there's a pending AI login (Human vs AI mode), send it now
    if (window.pendingAILogin) {
      console.log("Sending pending AI login...");
      ws.send(JSON.stringify(window.pendingAILogin));
      window.pendingAILogin = null;
    }
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
  
  // Handle checkbox state
  const showBidsCheck = document.getElementById("showBidsCheck");
  if (!data.isFirstPlayer) {
    showBidsCheck.disabled = true;
    showBidsCheck.checked = showBidsMode;
    showBidsCheck.parentElement.style.opacity = "0.5";
    showBidsCheck.parentElement.title = "Only first player can set this option";
  }
}

function handleAudienceJoin() {
  loggedIn = true;
  isAudience = true;
  myPlayer = null; // Explicitly set myPlayer to null for audience members
  document.getElementById("loginPanel").style.display = "none";
  document.getElementById("audiencePanel").style.display = "none";
  document.getElementById("gamePanel").style.display = "block";
  document.getElementById("playerNameSpan").textContent = "(Audience)";
  // Hide the bid input UI
  document.getElementById("bidInput").disabled = true;
  document.querySelector("#bidInput + button").disabled = true;
  showStatus("You are an Audience member. You can watch but not bid.");
}

function handleGameState(data) {
  if (!isAudience && myPlayer) {
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
}

function handleTurnResolution(data) {
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
}

function handlePlayerUpdate(data) {
  if (myPlayer && !isAudience) {
    myPlayer.updateGameState({
      money: data.money,
      lastBid: data.lastBid
    });
    updatePlayerStats();
    updateBidInput();
  }
}

function handleBidStatus(data) {
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
}

function handleGameOver(data) {
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
}

//////////////////////////////////////////////////
// UI for login
//////////////////////////////////////////////////
// Login as player
function loginAsPlayer() {
    const nameInput = document.getElementById("nameInput");
    const passInput = document.getElementById("passInput");
    const showBidsCheck = document.getElementById("showBidsCheck");
    const gameModeRadios = document.getElementsByName("gameMode");
    let selectedMode = 'human';
    
    for (const radio of gameModeRadios) {
        if (radio.checked) {
            selectedMode = radio.value;
            break;
        }
    }
    
    if (!nameInput.value) {
        showError('Please enter your name');
        return;
    }
    
    if (selectedMode === 'ai_vs_ai') {
        handleAIvsAILogin();
        return;
    }
    
    const isAI = false;
    const aiType = null;
    const isFirstPlayer = !window.waitingPlayer;
    
    const loginMessage = {
        type: 'LOGIN',
        playerName: nameInput.value,
        passcode: passInput.value,
        showBids: showBidsCheck.checked,
        isAI,
        aiType,
        isFirstPlayer
    };
    
    ws.send(JSON.stringify(loginMessage));
}

function handleAIvsAILogin() {
    console.log('Starting AI vs AI match');
    // First AI player login
    ws.send(JSON.stringify({
        type: 'LOGIN',
        playerName: 'Claude',
        passcode: 'ai_match',
        showBids: true,
        isAI: true,
        aiType: 'claude',
        isFirstPlayer: true
    }));
    
    // Second AI player login after a short delay
    setTimeout(() => {
        ws.send(JSON.stringify({
            type: 'LOGIN',
            playerName: 'GPT-4',
            passcode: 'ai_match',
            showBids: true,
            isAI: true,
            aiType: 'openai',
            isFirstPlayer: false
        }));
        
        // Start the game after both AIs have joined
        setTimeout(() => {
            ws.send(JSON.stringify({
                type: 'START_GAME',
                playerName: 'Claude'
            }));
            
            // Join as audience to watch
            setTimeout(() => {
                ws.send(JSON.stringify({
                    type: 'AUDIENCE_JOIN'
                }));
            }, 500);
        }, 1000);
    }, 1000);
}

// Join as audience
function joinAsAudience() {
    ws.send(JSON.stringify({
        type: 'AUDIENCE_JOIN'
    }));
}

//////////////////////////////////////////////////
// Bidding
//////////////////////////////////////////////////
// Setup bid field mask
function setupBidFieldMask() {
  const bidInput = document.getElementById("bidInput");
  const bidLabel = document.querySelector('label[for="bidInput"]') || bidInput.previousElementSibling;
  
  bidInput.value = "";
  realBidValue = "";

  // Update the label to show max $100 at start or current money during game
  function updateBidLabel() {
    if (!myPlayer || !myPlayer.gameState) {
      bidLabel.textContent = `Your Bid (max $100): `;
      bidInput.max = 100;
      return;
    }
    const maxBid = myPlayer.gameState.money;
    bidLabel.textContent = `Your Bid (max $${maxBid}): `;
    bidInput.max = maxBid;
  }
  
  // Initial update
  updateBidLabel();

  bidInput.addEventListener("input", (e) => {
    const newVal = e.target.value;
    // Only allow numbers
    const numericVal = newVal.replace(/[^0-9]/g, '');
    
    if (numericVal.length > 0) {
      const maxBid = myPlayer?.gameState?.money || 100;
      const validatedBid = Math.min(parseInt(numericVal), maxBid);
      realBidValue = validatedBid.toString();
      e.target.value = validatedBid.toString();
      console.log("Bid input:", { value: validatedBid, maxBid, money: myPlayer?.gameState?.money });
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

// Submit bid to server
function submitBid() {
    const bidInput = document.getElementById("bidInput");
    const bid = parseInt(bidInput.value);
    
    if (isNaN(bid) || bid < 0 || bid > gameState.myMoney) {
        showError(`Please enter a valid bid between 0 and ${gameState.myMoney}`);
        return;
    }
    
    ws.send(JSON.stringify({
        type: 'SUBMIT_BID',
        playerName: gameState.playerName,
        bid: bid
    }));
    
    bidInput.value = '';
    bidInput.disabled = true;
    document.querySelector('button[onclick="submitBid()"]').disabled = true;
}

//////////////////////////////////////////////////
// Show status text
//////////////////////////////////////////////////
// Show status message
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
// Start replay of game
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

// Replay next turn
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

// Show winner popup
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

// Update leaderboard display
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

// Request leaderboard from server
function requestLeaderboard() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "REQUEST_LEADERBOARD" }));
  }
}