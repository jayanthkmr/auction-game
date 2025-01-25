// Base Message class
class Message {
  constructor(data) {
    this.type = data.type;
    this.data = data;
  }

  // Validate message format
  validate() {
    switch (this.type) {
      case 'LOGIN':
        return this.validateLogin();
      case 'AUDIENCE_JOIN':
        return true;
      case 'START_GAME':
        return this.validateStartGame();
      case 'SUBMIT_BID':
        return this.validateBid();
      case 'REQUEST_LEADERBOARD':
        return true;
      default:
        return false;
    }
  }

  validateLogin() {
    const { playerName, passcode } = this.data;
    return typeof playerName === 'string' && 
           playerName.length > 0 &&
           (!passcode || typeof passcode === 'string');
  }

  validateStartGame() {
    const { playerName } = this.data;
    return typeof playerName === 'string' && playerName.length > 0;
  }

  validateBid() {
    const { playerName, bid } = this.data;
    return typeof playerName === 'string' && 
           playerName.length > 0 &&
           typeof bid === 'number' &&
           bid >= 0;
  }

  // Convert message to JSON
  toJSON() {
    return { type: this.type, data: this.data };
  }
}

// Login Messages
class LoginMessage extends Message {
  constructor(playerName, passcode, showBids = false, isAI = false, aiType = null, isFirstPlayer = false) {
    super({ type: 'LOGIN', playerName, passcode, showBids, isAI, aiType, isFirstPlayer });
  }

  // Convert login message to JSON
  toJSON() {
    return {
      ...super.toJSON(),
      playerName: this.data.playerName,
      passcode: this.data.passcode,
      showBids: this.data.showBids,
      isAI: this.data.isAI,
      aiType: this.data.aiType,
      isFirstPlayer: this.data.isFirstPlayer
    };
  }
}

// Game Control Messages
class StartGameMessage extends Message {
  constructor(playerName) {
    super({ type: 'START_GAME', playerName });
  }

  toJSON() {
    return {
      ...super.toJSON(),
      playerName: this.data.playerName
    };
  }
}

class BidMessage extends Message {
  constructor(playerName, bid) {
    super({ type: 'SUBMIT_BID', playerName, bid });
  }

  toJSON() {
    return {
      ...super.toJSON(),
      playerName: this.data.playerName,
      bid: this.data.bid
    };
  }
}

// AI Messages
class RequestAIBidsMessage extends Message {
  constructor(p1Name, p2Name) {
    super({ type: 'REQUEST_AI_BIDS', p1Name, p2Name });
  }

  toJSON() {
    return {
      ...super.toJSON(),
      p1Name: this.data.p1Name,
      p2Name: this.data.p2Name
    };
  }
}

// Status Messages
class GameStateMessage extends Message {
  constructor(scotchPosition, turnNumber, maxTurns, gameOver = false, money = null, lastBid = null) {
    super({ type: 'GAME_STATE', scotchPosition, turnNumber, maxTurns, gameOver, money, lastBid });
  }

  toJSON() {
    const json = {
      ...super.toJSON(),
      scotchPosition: this.data.scotchPosition,
      turnNumber: this.data.turnNumber,
      maxTurns: this.data.maxTurns,
      gameOver: this.data.gameOver
    };
    if (this.data.money !== null) json.money = this.data.money;
    if (this.data.lastBid !== null) json.lastBid = this.data.lastBid;
    return json;
  }
}

class BidStatusMessage extends Message {
  constructor(p1Name, p2Name, p1Submitted, p2Submitted, turnNumber = null) {
    super({ type: 'BID_STATUS', p1Name, p2Name, p1Submitted, p2Submitted, turnNumber });
  }

  toJSON() {
    const json = {
      ...super.toJSON(),
      p1Name: this.data.p1Name,
      p2Name: this.data.p2Name,
      p1Submitted: this.data.p1Submitted,
      p2Submitted: this.data.p2Submitted
    };
    if (this.data.turnNumber !== null) json.turnNumber = this.data.turnNumber;
    return json;
  }
}

// Factory function to create messages from raw data
function createMessage(data) {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    return new Message(parsed);
  } catch (error) {
    throw new Error('Invalid message format');
  }
}

module.exports = {
  Message,
  LoginMessage,
  StartGameMessage,
  BidMessage,
  RequestAIBidsMessage,
  GameStateMessage,
  BidStatusMessage,
  createMessage
}; 