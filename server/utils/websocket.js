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
  broadcastAll(wss, {
    type: 'BID_STATUS',
    p1Name: game.players[0].name,
    p2Name: game.players[1].name,
    p1Submitted: game.players[0].lastBid !== null,
    p2Submitted: game.players[1].lastBid !== null,
    turnNumber: game.turnNumber,
    maxTurns: game.maxTurns
  });
}

module.exports = {
  sendMessage,
  broadcastAll,
  broadcastBidStatus
}; 