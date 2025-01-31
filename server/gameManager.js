const { Player } = require('./models/Player');
const { broadcastAll } = require('./utils/websocket');
const { handleAIBid } = require('./services/gameService');

class GameManager {
    constructor(wss, leaderboard) {
        this.wss = wss;
        this.leaderboard = leaderboard;
        this.games = new Map(); // playerName -> game
        this.audiences = new Set();
        this.activePlayers = new Set(); // Track active players
        this.currentPasscode = null; // Store current passcode
    }

    handlePlayerJoin(ws, playerName, isAI, aiType, showBids, isFirstPlayer, passcode = null) {
        // Validate inputs
        if (!ws || !playerName) {
            throw new Error('Invalid connection or player name');
        }

        // Check active players limit (max 2)
        if (this.activePlayers.size >= 2 && !isAI) {
            throw new Error('Maximum number of players (2) already reached');
        }

        // Handle passcode matching
        if (isFirstPlayer) {
            // First player must provide a passcode
            if (!passcode) {
                throw new Error('First player must set a passcode');
            }
            this.currentPasscode = passcode;
        } else if (!isAI) {
            // Second player must match the existing passcode
            if (!this.currentPasscode) {
                throw new Error('No game available to join');
            }
            if (passcode !== this.currentPasscode) {
                throw new Error('Invalid passcode');
            }
        }

        // Check if player is already in a game
        const existingGame = this.getGameByPlayer(playerName);
        if (existingGame && existingGame.status === 'active') {
            throw new Error('Player already in an active game');
        }

        const player = new Player(playerName, ws, isAI, aiType);
        let game;

        // Find a waiting game or create new one
        for (const [_, g] of this.games) {
            if (g.status === 'waiting' && g.players.length === 1) {
                game = g;
                break;
            }
        }
        
        if (!game) {
            // Create new game
            game = {
                players: [],
                status: 'waiting',
                scotchPosition: 5,
                turnNumber: 1,
                maxTurns: 5,
                showBids: showBids,
                turnHistory: [],
                passcode: this.currentPasscode
            };
        }

        // Add player to game
        if (game.players.length === 0) {
            game.players.push(player);
            game.showBids = showBids;
            if (!isAI) {
                this.activePlayers.add(playerName);
            }
        } else if (game.players.length === 1) {
            // Don't allow same player to join twice
            if (game.players[0].name === playerName) {
                throw new Error('Cannot join your own game');
            }
            game.players.push(player);
            game.status = 'active'; // Game starts when second player joins
            if (!isAI) {
                this.activePlayers.add(playerName);
            }
        } else {
            throw new Error('Game is full');
        }

        // Map both player names to this game
        this.games.set(playerName, game);
        if (game.players.length === 2) {
            this.games.set(game.players[0].name, game);
            this.games.set(game.players[1].name, game);
        }

        return game;
    }

    handleAudienceJoin(ws) {
        this.audiences.add(ws);
        // Send current game states to new audience member
        for (const [_, game] of this.games) {
            if (game.status === 'active') {
                this.broadcastGameState(game, ws);
            }
        }
    }

    getGameByPlayer(playerName) {
        return this.games.get(playerName);
    }

    placeBid(game, player, bid) {
        if (!game || !player) {
            throw new Error('Invalid game or player');
        }

        if (player.lastBid !== null) {
            throw new Error('Already submitted bid for this turn');
        }

        if (bid < 0 || bid > player.money) {
            throw new Error(`Invalid bid amount. Must be between 0 and ${player.money}`);
        }

        // Submit the bid
        player.submitBid(bid);

        // Check if both players have bid
        const allBidsSubmitted = game.players.every(p => p.lastBid !== null);
        
        // Broadcast bid status
        this.broadcastBidStatus(game);

        // If all bids are in, resolve the turn
        if (allBidsSubmitted) {
            this.resolveTurn(game);
        }

        return true;
    }

    resolveTurn(game) {
        if (!game || !game.players || game.players.length !== 2) {
            throw new Error('Invalid game state');
        }

        const [p1, p2] = game.players;
        const p1Bid = p1.lastBid;
        const p2Bid = p2.lastBid;
        
        if (p1Bid === null || p2Bid === null) {
            throw new Error('Missing bids');
        }

        // Store money before for history
        const p1MoneyBefore = p1.money + p1Bid;
        const p2MoneyBefore = p2.money + p2Bid;
        
        // Determine winner
        let winner;
        let tieUsed = false;
        
        if (p1Bid > p2Bid) {
            winner = p1;
            game.scotchPosition--;
        } else if (p2Bid > p1Bid) {
            winner = p2;
            game.scotchPosition++;
        } else {
            // Tie goes to player closer to their goal
            winner = game.scotchPosition <= 5 ? p1 : p2;
            tieUsed = true;
            game.scotchPosition += (winner === p2 ? 1 : -1);
        }

        // Record turn history
        game.turnHistory.push({
            turnNumber: game.turnNumber,
            p1Name: p1.name,
            p2Name: p2.name,
            p1Bid,
            p2Bid,
            p1MoneyBefore,
            p2MoneyBefore,
            p1MoneyAfter: p1.money,
            p2MoneyAfter: p2.money,
            winner: winner === p1 ? 1 : 2,
            tieUsed,
            oldPosition: game.scotchPosition + (winner === p1 ? 1 : -1),
            newPosition: game.scotchPosition
        });

        // Clear bids for next turn
        p1.lastBid = null;
        p2.lastBid = null;

        // Check if game is over
        const gameOver = this.checkGameOver(game);
        if (gameOver) {
            this.endGame(game);
        } else {
            game.turnNumber++;
            this.broadcastTurnResolution(game);
        }
    }

    checkGameOver(game) {
        return game.turnNumber >= game.maxTurns || 
               game.scotchPosition <= 0 || 
               game.scotchPosition >= 10;
    }

    endGame(game) {
        const winner = game.scotchPosition <= 0 ? game.players[0] : game.players[1];
        const loser = winner === game.players[0] ? game.players[1] : game.players[0];
        
        // Update player stats
        winner.updateStats(true);
        loser.updateStats(false);

        // Update ratings
        const ratingChanges = this.leaderboard.updateRatings(winner, loser);

        // Broadcast game over
        this.broadcastGameOver(game, ratingChanges);

        // Clean up game
        this.games.delete(winner.name);
        this.games.delete(loser.name);
    }

    broadcastGameState(game, targetWs = null) {
        const message = {
            type: 'GAME_STATE',
            turnNumber: game.turnNumber,
            maxTurns: game.maxTurns,
            scotchPosition: game.scotchPosition,
            gameOver: false,
            status: game.status
        };

        // Add player-specific info
        game.players.forEach(player => {
            const playerMsg = {
                ...message,
                money: player.money,
                lastBid: player.lastBid
            };
            if (targetWs) {
                if (player.ws === targetWs) {
                    player.ws.send(JSON.stringify(playerMsg));
                }
            } else {
                player.ws.send(JSON.stringify(playerMsg));
            }
        });

        // Send general state to audience
        if (targetWs && this.audiences.has(targetWs)) {
            targetWs.send(JSON.stringify(message));
        } else {
            this.audiences.forEach(ws => {
                ws.send(JSON.stringify(message));
            });
        }
    }

    broadcastTurnResolution(game) {
        const lastTurn = game.turnHistory[game.turnHistory.length - 1];
        const message = {
            type: 'TURN_RESOLVED',
            ...lastTurn,
            turnNumber: game.turnNumber,
            maxTurns: game.maxTurns
        };

        broadcastAll(this.wss, message);
    }

    broadcastBidStatus(game) {
        const message = {
            type: 'BID_STATUS',
            p1Name: game.players[0].name,
            p2Name: game.players[1].name,
            p1Submitted: game.players[0].lastBid !== null,
            p2Submitted: game.players[1].lastBid !== null,
            turnNumber: game.turnNumber,
            maxTurns: game.maxTurns
        };

        broadcastAll(this.wss, message);
    }

    broadcastGameOver(game, ratingChanges) {
        const message = {
            type: 'GAME_OVER',
            turnHistory: game.turnHistory,
            ratingChanges
        };

        broadcastAll(this.wss, message);
    }

    findGameByWebSocket(ws) {
        for (const [_, game] of this.games) {
            if (game.players.some(p => p.ws === ws)) {
                return game;
            }
        }
        return null;
    }

    handleDisconnect(ws) {
        // Remove from audiences if they were a spectator
        this.audiences.delete(ws);

        // Find the game this player was in
        const game = this.findGameByWebSocket(ws);
        if (!game) return;

        // Find the disconnected player
        const disconnectedPlayer = game.players.find(p => p.ws === ws);
        if (!disconnectedPlayer) return;

        // The other player wins by default
        const winner = game.players.find(p => p !== disconnectedPlayer);
        if (winner) {
            // Update stats
            winner.updateStats(true);
            disconnectedPlayer.updateStats(false);

            // Update ratings
            const ratingChanges = this.leaderboard.updateRatings(winner, disconnectedPlayer);

            // Broadcast game over with disconnect reason
            this.broadcastGameOver(game, {
                ...ratingChanges,
                reason: 'disconnect',
                disconnectedPlayer: disconnectedPlayer.name
            });
        }

        // Clean up the game
        game.players.forEach(player => {
            this.games.delete(player.name);
        });
    }
}

module.exports = { GameManager }; 