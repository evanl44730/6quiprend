const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Game } = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all for GitHub Pages compatibility
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files from 'public' directory
// Serve static files from root directory
app.use(express.static(__dirname));

const game = new Game();

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Initial state
    socket.emit('gameState', game.getPublicState());

    socket.on('joinGame', (name) => {
        if (!game.players[socket.id]) {
            game.addPlayer(socket.id, name || `Player ${socket.id.substr(0, 4)}`);
            io.emit('gameState', game.getPublicState()); // Broadcast update
            console.log(`${name} joined.`);
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        if (game.players[socket.id]) {
            game.removePlayer(socket.id);
            io.emit('gameState', game.getPublicState());
        }
    });

    // Add debug/admin command to start game
    socket.on('playCard', (cardNumber) => {
        if (game.gameState !== 'selecting_cards') return;

        const success = game.playCard(socket.id, cardNumber);
        if (success) {
            // Update this player's hand
            socket.emit('hand', game.players[socket.id].hand);
            // Notify everyone that a player has played (for UI status)
            io.emit('gameState', game.getPublicState());

            // Check if all players played
            if (game.checkTurnReady()) {
                console.log('All players played. Resolving turn...');
                const result = game.resolveTurn(); // Just sets state to resolving
                handleTurnResult(result); // Starts the loop
            }
        }
    });

    // Choose a row (when card is too low)
    socket.on('chooseRow', (rowIndex) => {
        if (game.gameState !== 'resolving') return;

        const result = game.handleRowChoice(socket.id, rowIndex);
        if (result.error) {
            socket.emit('error', result.error);
        } else {
            // Choice made, result is stepComplete (row taken)
            handleTurnResult(result);
            // Resume loop
            setTimeout(() => {
                runResolutionLoop();
            }, 1500);
        }
    });

    socket.on('startGame', () => {
        // Only host can start
        if (game.hostId !== socket.id) {
            return;
        }

        // In real game, check if enough players etc.
        console.log('Starting game...');
        game.startRound();
        io.emit('gameState', game.getPublicState());

        // Send private hands to each player
        for (let sid in game.players) {
            const player = game.players[sid];
            io.to(sid).emit('hand', player.hand);
        }
    });

    socket.on('resetGame', () => {
        if (game.hostId === socket.id) {
            game.resetGame();
            io.emit('gameState', game.getPublicState());
        }
    });
});

// Resolution Loop
function runResolutionLoop(delay = 1500) {
    if (game.gameState !== 'resolving') return;

    // Process next step
    const result = game.processNextStep();

    handleTurnResult(result);

    if (result.type === 'stepComplete') {
        // Continue loop after delay
        setTimeout(() => {
            runResolutionLoop(delay);
        }, delay);
    }
}

function handleTurnResult(result) {
    if (result.type === 'resolving_start') {
        // Just notify start
        io.emit('gameState', game.getPublicState());
        setTimeout(() => runResolutionLoop(), 1000);
    }
    else if (result.type === 'stepComplete') {
        // A card was placed or row taken
        // Emit specific event for animation? Or just new state?
        // Let's emit state plus a 'playUpdate' event for toasts
        io.emit('gameState', game.getPublicState());

        const payload = result.payload;
        if (payload.rowTaken) {
            io.emit('rowTaken', {
                player: payload.player.name,
                points: payload.pointsTaken
            });
        }
    }
    else if (result.type === 'requestRowChoice') {
        // Pause loop, wait for user input
        const socketId = result.socketId;
        io.to(socketId).emit('requestRowChoice');
        io.emit('gameState', game.getPublicState());
        console.log(`Waiting for ${game.players[socketId].name} to choose a row.`);
    }
    else if (result.type === 'turnComplete') {
        // Turn finished, start next selection phase or end round
        io.emit('gameState', game.getPublicState());
        io.emit('turnComplete'); // Clear any temp visuals

        // If round is still going, players need to select cards again
        if (game.gameState === 'selecting_cards') {
            io.emit('newTurn'); // Trigger hand refresh if needed
            console.log('Turn complete. Starting new selection phase.');
        } else if (game.gameState === 'round_end') {
            console.log(`Round ${game.round} complete.`);
            console.log('Current Scores:', game.players);

            // Check for Game Over (66 points)
            const winner = game.checkGameEnd();

            if (winner) {
                console.log('Game Over! Winner:', winner.name);
                io.emit('gameOver', winner);
                // Game stays in round_end state until host resets (optional feature)
                // For now, let's allow host to "Start Game" again to full reset? 
                // We'll need a reset handler or just re-enable start button.
            } else {
                // Start new round after delay
                console.log('Starting next round in 5 seconds...');
                io.emit('roundEnd', { seconds: 5 }); // Optional countdown for client

                setTimeout(() => {
                    game.startRound();
                    io.emit('newRound'); // Client should clear board/hands
                    io.emit('gameState', game.getPublicState());

                    // Send new hands
                    for (let sid in game.players) {
                        io.to(sid).emit('hand', game.players[sid].hand);
                    }
                }, 5000);
            }
        }
    }
}

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
