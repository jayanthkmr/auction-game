const { Player } = require('./models/Player');
const { broadcastAll } = require('./utils/websocket');
const { handleAIBid } = require('./services/gameService');

class GameManager {
    constructor(wss, leaderboard) {
        this.wss = wss;
        this.leaderboard = leaderboard;
        this.games = new Map(); // gameId -> game state
        this.players = new Map(); // ws -> player
        this.waitingPlayer = null;
        this.audiences = new Set();
    }

    createGame(player1, player2, showBids = false) {
        const gameId = Date.now().toString();
        const game = {
            id: gameId,
            players: [player1, player2],
            currentTurn: 1,
            maxTurns: 5,
            bottlePosition: 5,
            showBids: showBids,
            bids: new Map(),
            gameOver: false,
            winner: null,
            replay: [],
            status: 'active' // Start game immediately when created
        };

        this.games.set(gameId, game);

        // If both players are AI, start the bidding
        if (player1.isAI && player2.isAI) {
            handleAIBid(game, player1);
            setTimeout(() => handleAIBid(game, player2), 1000);
        }
        // If only one player is AI and it's their turn, get their bid
        else if ((player1.isAI && !game.bids.has(player1)) || 
                 (player2.isAI && !game.bids.has(player2))) {
            const aiPlayer = player1.isAI ? player1 : player2;
            handleAIBid(game, aiPlayer);
        }

        return game;
    }

    handlePlayerJoin(ws, name, isAI = false, aiType = null, showBids = false, isFirstPlayer = false) {
        const player = new Player(name, isAI, aiType, ws, showBids, isFirstPlayer);
        this.players.set(ws, player);
        this.leaderboard.addPlayer(player);

        if (!this.waitingPlayer) {
            this.waitingPlayer = { ws, player };
            return null;
        }

        const game = this.createGame(
            this.waitingPlayer.player,
            player,
            this.waitingPlayer.player.showBids || player.showBids
        );

        this.broadcastGameState(game);
        this.waitingPlayer = null;
        return game;
    }

    handleAudienceJoin(ws) {
        this.audiences.add(ws);
        
        // Send current game states to the new audience member
        for (const game of this.games.values()) {
            if (!game.gameOver) {
                ws.send(JSON.stringify({
                    type: 'GAME_STATE',
                    currentTurn: game.currentTurn,
                    maxTurns: game.maxTurns,
                    scotchPosition: game.bottlePosition,
                    status: game.status,
                    showBids: game.showBids,
                    gameOver: game.gameOver,
                    p1Name: game.players[0].name,
                    p2Name: game.players[1].name
                }));
            }
        }
    }

    handleDisconnect(ws) {
        if (this.waitingPlayer?.ws === ws) {
            this.waitingPlayer = null;
        }

        const player = this.players.get(ws);
        this.players.delete(ws);
        this.audiences.delete(ws);

        // Handle game disconnection
        if (player) {
            for (const [gameId, game] of this.games.entries()) {
                if (game.players.includes(player)) {
                    game.gameOver = true;
                    game.status = 'finished';
                    game.winner = game.players.find(p => p !== player);
                    this.broadcastGameOver(game, 'disconnect');
                    this.games.delete(gameId);
                    break;
                }
            }
        }
    }

    getGameByPlayer(playerName) {
        for (const game of this.games.values()) {
            if (game.players.some(p => p.name === playerName)) {
                return game;
            }
        }
        return null;
    }

    placeBid(ws, amount) {
        const game = this.getPlayerGame(ws);
        if (!game || game.gameOver || game.status !== 'active') return false;

        const player = this.players.get(ws);
        if (!player || game.bids.has(player)) return false;

        try {
            player.submitBid(amount);
            game.bids.set(player, amount);

            // Broadcast bid status
            this.broadcastBidStatus(game, player);

            // If both players have bid, resolve the turn
            if (game.bids.size === 2) {
                this.resolveTurn(game);
            } else if (game.players.some(p => p.isAI)) {
                // If one player is AI and hasn't bid yet, get their bid
                const aiPlayer = game.players.find(p => p.isAI && !game.bids.has(p));
                if (aiPlayer) {
                    handleAIBid(game, aiPlayer);
                }
            }

            return true;
        } catch (error) {
            console.error('Error placing bid:', error);
            return false;
        }
    }

    getPlayerGame(ws) {
        const player = this.players.get(ws);
        if (!player) return null;

        for (const game of this.games.values()) {
            if (game.players.includes(player)) {
                return game;
            }
        }
        return null;
    }

    resolveTurn(game) {
        const [bid1, bid2] = [...game.bids.entries()];
        const [player1, amount1] = bid1;
        const [player2, amount2] = bid2;

        let winner, loser, winningBid, losingBid;
        if (amount1 > amount2) {
            [winner, winningBid] = [player1, amount1];
            [loser, losingBid] = [player2, amount2];
        } else if (amount2 > amount1) {
            [winner, winningBid] = [player2, amount2];
            [loser, losingBid] = [player1, amount1];
        } else {
            // Tie breaker: alternate advantage
            if (game.currentTurn % 2 === 1) {
                [winner, winningBid] = [player1, amount1];
                [loser, losingBid] = [player2, amount2];
            } else {
                [winner, winningBid] = [player2, amount2];
                [loser, losingBid] = [player1, amount1];
            }
        }

        // Update game state
        winner.payBid();
        game.bottlePosition += game.players.indexOf(winner) === 0 ? -1 : 1;
        game.currentTurn++;
        game.bids.clear();

        // Record turn in replay
        game.replay.push(
            `Turn ${game.currentTurn - 1}: ${winner.name} won with $${winningBid}` +
            (game.showBids ? ` vs $${losingBid}` : '')
        );

        // Check for game over
        if (game.bottlePosition === 0 || game.bottlePosition === 10 || game.currentTurn > game.maxTurns) {
            this.endGame(game);
        } else {
            // If game continues and next player is AI, get their bid
            const nextAiPlayer = game.players.find(p => p.isAI && !game.bids.has(p));
            if (nextAiPlayer) {
                setTimeout(() => handleAIBid(game, nextAiPlayer), 1000);
            }
        }

        // Broadcast updates
        this.broadcastTurnResolution(game, winner, winningBid, losingBid);
        this.broadcastGameState(game);
    }

    endGame(game, reason = null) {
        game.gameOver = true;
        game.status = 'finished';
        
        // Determine winner
        let winner;
        if (game.bottlePosition === 0) {
            winner = game.players[0];
        } else if (game.bottlePosition === 10) {
            winner = game.players[1];
        } else {
            // Compare distance from each player's goal
            const dist1 = game.bottlePosition;
            const dist2 = 10 - game.bottlePosition;
            winner = dist1 < dist2 ? game.players[0] : game.players[1];
        }
        
        game.winner = winner;
        const loser = game.players.find(p => p !== winner);

        // Store old ratings for calculating changes
        winner.oldRating = winner.rating;
        loser.oldRating = loser.rating;

        // Update ratings
        const ratingChange = this.leaderboard.updateRatings(winner, loser);
        
        // Record game results
        winner.recordGameResult(true);
        loser.recordGameResult(false);

        // Broadcast game over
        this.broadcastGameOver(game, reason);
        
        // Broadcast updated leaderboard
        this.broadcastLeaderboard();
    }

    broadcastGameState(game) {
        const message = {
            type: 'GAME_STATE',
            currentTurn: game.currentTurn,
            maxTurns: game.maxTurns,
            scotchPosition: game.bottlePosition,
            status: game.status,
            showBids: game.showBids,
            gameOver: game.gameOver,
            p1Name: game.players[0].name,
            p2Name: game.players[1].name
        };

        game.players.forEach((player, index) => {
            if (player.ws) {
                player.ws.send(JSON.stringify({
                    ...message,
                    money: player.money,
                    isYourTurn: !game.bids.has(player)
                }));
            }
        });

        // Broadcast to audience
        this.audiences.forEach(ws => {
            ws.send(JSON.stringify(message));
        });
    }

    broadcastTurnResolution(game, winner, winningBid, losingBid) {
        const message = {
            type: 'TURN_RESOLVED',
            winner: game.players.indexOf(winner) + 1,
            winningBid,
            losingBid: game.showBids ? losingBid : null,
            scotchPosition: game.bottlePosition,
            turnNumber: game.currentTurn,
            maxTurns: game.maxTurns,
            gameOver: game.gameOver
        };

        broadcastAll(this.wss, message);
    }

    broadcastBidStatus(game, player) {
        broadcastAll(this.wss, {
            type: 'BID_STATUS',
            p1Name: game.players[0].name,
            p2Name: game.players[1].name,
            p1Submitted: game.bids.has(game.players[0]),
            p2Submitted: game.bids.has(game.players[1]),
            turnNumber: game.currentTurn
        });
    }

    broadcastGameOver(game, reason = null) {
        const message = {
            type: 'GAME_OVER',
            winner: game.winner.name,
            reason: reason || this.getGameOverReason(game),
            replay: game.replay,
            finalState: {
                p1Name: game.players[0].name,
                p2Name: game.players[1].name,
                p1MoneyAfter: game.players[0].money,
                p2MoneyAfter: game.players[1].money,
                newPosition: game.bottlePosition,
                finalWinner: game.winner.name
            },
            ratingChanges: {
                winner: {
                    name: game.winner.name,
                    ratingChange: game.winner.rating - game.winner.oldRating,
                    newRating: game.winner.rating
                },
                loser: {
                    name: game.players.find(p => p !== game.winner).name,
                    ratingChange: -(game.winner.rating - game.winner.oldRating),
                    newRating: game.players.find(p => p !== game.winner).rating
                }
            }
        };

        if (reason === 'disconnect') {
            message.disconnect = game.players.find(p => p !== game.winner).name;
        }

        broadcastAll(this.wss, message);
    }

    broadcastLeaderboard() {
        const leaderboardData = this.leaderboard.getLeaderboard();
        broadcastAll(this.wss, {
            type: 'LEADERBOARD_UPDATE',
            leaderboard: leaderboardData
        });
    }

    getGameOverReason(game) {
        if (game.bottlePosition === 0) {
            return 'Player 1 got the bottle to position 0';
        } else if (game.bottlePosition === 10) {
            return 'Player 2 got the bottle to position 10';
        } else {
            return `Game ended after ${game.maxTurns} turns - closest player wins`;
        }
    }
}

module.exports = { GameManager }; 