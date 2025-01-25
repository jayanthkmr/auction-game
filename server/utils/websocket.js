function sendMessage(ws, message) {
  if (ws && ws.readyState === 1) { // WebSocket.OPEN
    ws.send(JSON.stringify(message));
  }
}

function broadcastAll(wss, message) {
  const messageStr = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(messageStr);
    }
  });
}

function broadcastBidStatus(wss, game) {
  const message = {
    type: 'BID_STATUS',
    p1Name: game.player1.name,
    p2Name: game.player2.name,
    p1Submitted: game.player1.bidSubmitted,
    p2Submitted: game.player2.bidSubmitted,
    turnNumber: game.currentTurn + 1
  };

  broadcastAll(wss, message);
}

module.exports = {
  sendMessage,
  broadcastAll,
  broadcastBidStatus
}; 