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
let myPlayerName = null;
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

// Add to your existing state variables at the top
let isFirstPlayer = true;

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
  console.log("Starting animation:", oldPos, "->", newPos);
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
  // Set canvas dimensions
  canvas.width = 600;
  canvas.height = 200;
  
  // In case scotchImg wasn't loaded, we'll still attempt the baseline
  drawBaseline(scotchPosition);
  
  // Add passcode styles
  document.head.appendChild(passcodeStyle);
  
  // Initialize bid field mask
  updateBidLabel = setupBidFieldMask();
  
  // Connect to WebSocket and set up initial state
  connectWebSocket();
  
  // Initialize leaderboard table
  const leaderboardTable = document.getElementById("leaderboardTable");
  if (leaderboardTable) {
    const tbody = leaderboardTable.querySelector("tbody");
    if (!tbody) {
      const newTbody = document.createElement("tbody");
      leaderboardTable.appendChild(newTbody);
    }
  }
  
  // Request initial leaderboard data after a short delay to ensure WebSocket is connected
  setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      requestLeaderboard();
    }
  }, 1000);
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
      updateLeaderboardDisplay(data.leaderboard);
      break;

    default:
      console.warn('Unknown message type:', data);
      break;
  }
}

function handleLoginSuccess(data) {
  const isHumanLogin = !data.isAI;
  
  if (isHumanLogin) {
    myPlayerName = data.playerName;
    isFirstPlayer = data.isFirstPlayer;
    gameState = {
      myMoney: 100,
      turnNumber: 1,
      maxTurns: MAX_TURNS,
      lastBid: 0,
      isGameOver: false
    };
    
    loggedIn = true;
    isAudience = false;
    showBidsMode = data.showBidsMode;
    
    // Update UI with null checks
    const loginPanel = document.getElementById("loginPanel");
    const gamePanel = document.getElementById("gamePanel");
    const playerNameSpan = document.getElementById("playerNameSpan");
    
    if (loginPanel) loginPanel.style.display = "none";
    if (gamePanel) {
      gamePanel.style.display = "block";
      
      // Show passcode reminder for first player
      if (isFirstPlayer) {
        const passcodeDisplay = document.createElement('div');
        passcodeDisplay.className = 'passcode-display';
        passcodeDisplay.innerHTML = `
          <div class="passcode-box">
            <span>Your passcode for Player 2: <strong>${data.passcode}</strong></span>
            <button onclick="copyPasscode('${data.passcode}')" class="copy-btn">Copy</button>
          </div>
        `;
        gamePanel.insertBefore(passcodeDisplay, gamePanel.firstChild);
      }
    }
    if (playerNameSpan) playerNameSpan.textContent = myPlayerName;
    
    // Update UI elements
    updatePlayerStats();
    updateBidInput();
    
    showStatus(`Logged in with $${gameState.myMoney}`);
    if (isFirstPlayer) {
      showStatus(`Share your passcode with Player 2: ${data.passcode}`);
    }
    
    // Initialize canvas
    if (canvas) {
      canvas.width = 600;
      canvas.height = 200;
      drawBaseline(scotchPosition);
    }
    
    // Request initial leaderboard data
    requestLeaderboard();
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
  
  // Handle checkbox state with null check
  const showBidsCheck = document.getElementById("showBidsCheck");
  if (showBidsCheck && !data.isFirstPlayer) {
    showBidsCheck.disabled = true;
    showBidsCheck.checked = showBidsMode;
    if (showBidsCheck.parentElement) {
      showBidsCheck.parentElement.style.opacity = "0.5";
      showBidsCheck.parentElement.title = "Only first player can set this option";
    }
  }
}

function handleAudienceJoin() {
  loggedIn = true;
  isAudience = true;
  myPlayerName = null;
  gameState = {
    turnNumber: 0,
    maxTurns: MAX_TURNS,
    myMoney: 0,
    lastBid: null,
    isGameOver: false
  };
  
  const loginPanel = document.getElementById("loginPanel");
  const gamePanel = document.getElementById("gamePanel");
  const playerNameSpan = document.getElementById("playerNameSpan");
  const bidInput = document.getElementById("bidInput");
  const bidButton = document.querySelector("#bidInput + button");
  
  if (loginPanel) loginPanel.style.display = "none";
  if (gamePanel) gamePanel.style.display = "block";
  if (playerNameSpan) playerNameSpan.textContent = "(Audience)";
  if (bidInput) bidInput.disabled = true;
  if (bidButton) bidButton.disabled = true;
  
  showStatus("You are an Audience member. You can watch but not bid.");
}

function handleGameState(data) {
  if (!isAudience) {
    gameState.turnNumber = data.turnNumber;
    gameState.maxTurns = data.maxTurns;
    gameState.isGameOver = data.gameOver;
    gameState.myMoney = data.money;
    gameState.lastBid = data.lastBid;
  }
  scotchPosition = data.scotchPosition || 5;
  drawBaseline(scotchPosition);
  showStatus(`Turn ${data.turnNumber}/${data.maxTurns}${data.gameOver ? " - Game Over!" : ""}`);
}

function handleTurnResolution(data) {
    console.log("Turn resolved:", data);
    
    // Update game state with proper initialization
    if (!isAudience) {
        // Determine if we're player 1 or 2
        const isPlayer1 = myPlayerName === data.p1Name;
        
        gameState = {
            ...gameState,
            turnNumber: data.turnNumber,
            maxTurns: data.maxTurns,
            myMoney: isPlayer1 ? data.p1MoneyAfter : data.p2MoneyAfter,
            lastBid: isPlayer1 ? data.p1Bid : data.p2Bid
        };
        
        // Update UI elements
        updatePlayerStats();
        updateBidInput();
    }

    // Get positions for animation
    const oldPos = data.oldPosition;
    const newPos = data.newPosition;
    
    // Update turn display
    const turnDisplay = document.getElementById("turnDisplay");
    if (turnDisplay) {
        turnDisplay.textContent = `Turn ${data.turnNumber} of ${data.maxTurns}`;
    }

    // Show turn result in status
    const winnerName = data.winner === 1 ? data.p1Name : data.p2Name;
    if (data.tieUsed) {
        showStatus(`Tie! ${winnerName} won due to advantage`);
    } else {
        showStatus(`${winnerName} won the turn!`);
    }

    // Show bid information if enabled
    if (showBidsMode) {
        showStatus(`${data.p1Name} bid: $${data.p1Bid}, ${data.p2Name} bid: $${data.p2Bid}`);
    }
    
    // Animate the scotch movement
    console.log("Animating from", oldPos, "to", newPos);
    animateScotchMove(oldPos, newPos, () => {
        scotchPosition = newPos;
    });
}

function handlePlayerUpdate(data) {
  if (myPlayerName && !isAudience) {
    gameState.myMoney = data.money;
    gameState.lastBid = data.lastBid;
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
  } else if (myPlayerName && myPlayerName === p1Name) {
    showStatus(`${p1Status} You have ${data.p1Submitted ? "" : "NOT "}submitted | ${p2Status} ${p2Name} has ${data.p2Submitted ? "" : "NOT "}submitted`);
  } else if (myPlayerName && myPlayerName === p2Name) {
    showStatus(`${p1Status} ${p1Name} has ${data.p1Submitted ? "" : "NOT "}submitted | ${p2Status} You have ${data.p2Submitted ? "" : "NOT "}submitted`);
  }

  // Redraw canvas to show updated names
  drawBaseline(scotchPosition);
}

function handleGameOver(data) {
  finalTurnHistory = data.turnHistory;
  if (!isAudience) {
    gameState.finalState = data.finalState;
    if (data.finalState && data.finalState.p1Name && data.finalState.p2Name) {
      gameState.myMoney = data.finalState[myPlayerName === data.finalState.p1Name ? 'p1MoneyAfter' : 'p2MoneyAfter'];
    }
  }
  showStatus("Game Over!");
  document.getElementById("replaySection").style.display = "block";
  
  // Handle rating changes and winner message
  if (data.ratingChanges) {
    lastRatingChanges = data.ratingChanges;
    const winner = data.ratingChanges.winner;
    const loser = data.ratingChanges.loser;
    
    // Show winner popup with detailed message
    let winnerMessage = `Game Over! ${winner.name} wins!`;
    if (data.finalState && data.finalState.scotchPosition !== undefined) {
      if (data.finalState.scotchPosition <= 3) {
        winnerMessage += "\nPlayer 1 won by reaching their goal!";
      } else if (data.finalState.scotchPosition >= 7) {
        winnerMessage += "\nPlayer 2 won by reaching their goal!";
      } else {
        winnerMessage += `\nWinner determined by final money: $${winner.newRating}`;
      }
    }
    showWinnerPopup(winnerMessage);

    // Update status with rating changes
    showStatus(`${winner.name} (${winner.oldRating} → ${winner.newRating}) defeats ${loser.name} (${loser.oldRating} → ${loser.newRating})`);
  }
}

//////////////////////////////////////////////////
// UI for login
//////////////////////////////////////////////////
// Login as player
function loginAsPlayer() {
  const nameInput = document.getElementById("nameInput");
  const passcodeInput = document.getElementById("passcodeInput");
  const showBidsCheck = document.getElementById("showBidsCheck");
  
  if (!nameInput || !nameInput.value.trim()) {
    showError("Please enter your name");
    return;
  }

  if (!passcodeInput || !passcodeInput.value.trim()) {
    showError("Please enter a passcode");
    return;
  }

  const playerName = nameInput.value.trim();
  const passcode = passcodeInput.value.trim();
  const showBids = showBidsCheck ? showBidsCheck.checked : false;

  // Send login request
  ws.send(JSON.stringify({
    type: 'LOGIN',
    playerName: playerName,
    passcode: passcode,
    showBids: showBids
  }));
}

// Add passcode input to login panel
document.addEventListener('DOMContentLoaded', function() {
  const loginPanel = document.getElementById("loginPanel");
  if (loginPanel) {
    const passcodeDiv = document.createElement('div');
    passcodeDiv.className = 'input-group';
    passcodeDiv.innerHTML = `
      <label for="passcodeInput">Passcode:</label>
      <input type="text" id="passcodeInput" placeholder="Set passcode if first player, or enter existing passcode">
      <small>First player: Set a passcode for second player to join with.</small>
    `;
    
    // Insert passcode input after name input
    const nameInput = document.querySelector('.input-group');
    if (nameInput) {
      nameInput.parentNode.insertBefore(passcodeDiv, nameInput.nextSibling);
    }
  }
});

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
    if (!myPlayerName || !gameState) {
      bidLabel.textContent = `Your Bid (max $100): `;
      bidInput.max = 100;
      return;
    }
    const maxBid = gameState.myMoney;
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
      const maxBid = gameState?.myMoney || 100;
      const validatedBid = Math.min(parseInt(numericVal), maxBid);
      realBidValue = validatedBid.toString();
      e.target.value = validatedBid.toString();
      console.log("Bid input:", { value: validatedBid, maxBid, money: gameState?.myMoney });
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
  if (!loggedIn || isAudience || !myPlayerName) {
    showError("You must be logged in to submit a bid");
    return;
  }
  
  const bidInt = parseInt(realBidValue || "0", 10);
  
  // Validate bid against current money
  if (bidInt > gameState.myMoney) {
    showError(`Bid ($${bidInt}) exceeds your money ($${gameState.myMoney})`);
    return;
  }
  
  // Only show submission message, not result
  showStatus(`Bid submitted: $${bidInt}`);
  
  ws.send(JSON.stringify({
      type: "SUBMIT_BID",
      playerName: myPlayerName,
    bid: bidInt
  }));
  
  // Clear the input
  realBidValue = "";
  const bidInput = document.getElementById("bidInput");
  if (bidInput) {
    bidInput.value = "";
    bidInput.disabled = true;
  }
  
  // Disable submit button
  const submitButton = document.querySelector("#bidInput + button");
  if (submitButton) {
    submitButton.disabled = true;
  }
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

// Show winner popup
function showWinnerPopup(message) {
  const popup = document.createElement('div');
  popup.className = 'winner-popup';
  popup.innerHTML = `
    <div class="winner-content">
      <h2>🏆 Game Over! 🏆</h2>
      <p>${message}</p>
      <button onclick="this.parentElement.parentElement.remove()">Close</button>
    </div>
  `;
  document.body.appendChild(popup);
}

// Add CSS for winner popup
const style = document.createElement('style');
style.textContent = `
  .winner-popup {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
  }
  .winner-content {
    background: white;
    padding: 20px;
    border-radius: 10px;
    text-align: center;
    max-width: 80%;
  }
  .winner-content h2 {
    color: #2c3e50;
    margin-bottom: 15px;
  }
  .winner-content button {
    margin-top: 15px;
    padding: 8px 16px;
    background: #3498db;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
  }
  .winner-content button:hover {
    background: #2980b9;
  }
`;

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
    if (!isAudience && myPlayerName && player.name === myPlayerName) {
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

function updatePlayerStats() {
  const myStats = document.getElementById("myStats");
  if (!myStats || !myPlayerName || !gameState) return;

  let statsText = `Your Money: $${gameState.myMoney}`;
  if (gameState.lastBid !== null && gameState.lastBid !== undefined) {
    statsText += ` | Last Bid: $${gameState.lastBid}`;
  } else {
    statsText += ` | Last Bid: $0`;
  }
  myStats.textContent = statsText;
}

function updateTurnDisplay() {
  const turnDisplay = document.getElementById("turnDisplay");
  if (!turnDisplay || !myPlayerName || !gameState) return;
  
  turnDisplay.textContent = `Turn ${gameState.turnNumber} of ${gameState.maxTurns}`;
}

function updateBidInput() {
  const bidInput = document.getElementById("bidInput");
  const submitButton = document.querySelector("#bidInput + button");
  const bidLabel = document.querySelector('label[for="bidInput"]');
  if (!bidInput || !submitButton) return;

  if (!myPlayerName || !gameState || gameState.isGameOver) {
    bidInput.disabled = true;
    submitButton.disabled = true;
    if (bidLabel) {
      bidLabel.textContent = `Your Bid (max $0):`;
    }
    return;
  }

  // Ensure we have a valid money value
  const currentMoney = typeof gameState.myMoney === 'number' ? gameState.myMoney : 100;
  const maxBid = Math.max(0, currentMoney);
  
  bidInput.disabled = false;
  submitButton.disabled = false;
  bidInput.max = maxBid;
  if (bidLabel) {
    bidLabel.textContent = `Your Bid (max $${maxBid}):`;
  }
  
  // Reset the input value
  bidInput.value = "";
  realBidValue = "";
  
  // Update player stats to ensure money display is in sync
  updatePlayerStats();
}

function showError(msg) {
  const errorDiv = document.getElementById("loginError");
  if (errorDiv) {
    errorDiv.textContent = msg;
    errorDiv.style.color = "#ff3333";
  }
  showStatus(`Error: ${msg}`);
}

// Add copy passcode function
function copyPasscode(code) {
  navigator.clipboard.writeText(code).then(() => {
    showStatus('Passcode copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy passcode:', err);
    showStatus('Failed to copy passcode');
  });
}

// Add CSS for passcode display
const passcodeStyle = document.createElement('style');
passcodeStyle.textContent = `
  .passcode-display {
    margin: 10px 0;
    padding: 10px;
    text-align: center;
  }
  .passcode-box {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: #2c3e50;
    padding: 10px 15px;
    border-radius: 5px;
    color: #fff;
  }
  .passcode-box strong {
    color: #ffcc00;
    font-size: 1.2em;
    letter-spacing: 1px;
  }
  .copy-btn {
    background: #3498db;
    color: white;
    border: none;
    padding: 5px 10px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.9em;
  }
  .copy-btn:hover {
    background: #2980b9;
  }
`;

// Add CSS for game code display
const gameCodeStyle = document.createElement('style');
gameCodeStyle.textContent = `
  .game-code-display {
    margin: 10px 0;
    padding: 10px;
    text-align: center;
  }
  .game-code-box {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: #2c3e50;
    padding: 10px 15px;
    border-radius: 5px;
    color: #fff;
  }
  .game-code-box strong {
    color: #ffcc00;
    font-size: 1.2em;
    letter-spacing: 1px;
  }
  .copy-btn {
    background: #3498db;
    color: white;
    border: none;
    padding: 5px 10px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 0.9em;
  }
  .copy-btn:hover {
    background: #2980b9;
  }
`;