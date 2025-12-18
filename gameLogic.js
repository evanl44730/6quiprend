class Card {
    constructor(number) {
        this.number = number;
        this.bullheads = this.calculateBullheads(number);
    }

    calculateBullheads(number) {
        if (number === 55) {
            return 7;
        }
        if (number % 11 === 0) {
            return 5; // 11, 22, 33, 44, 66, 77, 88, 99
        }
        if (number % 10 === 0) {
            return 3; // 10, 20, 30...
        }
        if (number % 5 === 0) {
            return 2; // 5, 15, 25... (55 is handled above)
        }
        return 1;
    }
}

class Game {
    constructor() {
        this.deck = [];
        this.rows = [[], [], [], []]; // 4 rows
        this.players = {}; // { socketId: { name, hand: [], score: 0, scorePile: [] } }
        this.gameState = 'waiting'; // waiting, selecting_cards, revealing, resolving, round_end, game_end
        this.round = 0;
        this.maxScore = 66; // Standard end condition

        // Turn state
        this.playedCards = []; // Array of { socketId, card }
        this.resolutionIndex = 0;
        this.pendingRowChoice = null; // socketId who needs to choose a row

        this.hostId = null; // Track who is host
    }

    generateDeck() {
        this.deck = [];
        for (let i = 1; i <= 104; i++) {
            this.deck.push(new Card(i));
        }
        this.shuffleDeck();
    }

    shuffleDeck() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    addPlayer(socketId, name) {
        this.players[socketId] = {
            id: socketId,
            name: name,
            hand: [],
            score: 0,
            scorePile: [] // Cards collected (optional, or just tally score directly)
        };

        // Set host if first player
        if (!this.hostId) {
            this.hostId = socketId;
        }
    }

    removePlayer(socketId) {
        delete this.players[socketId];

        // Reassign host if needed
        if (this.hostId === socketId) {
            const playerIds = Object.keys(this.players);
            this.hostId = playerIds.length > 0 ? playerIds[0] : null;
        }
    }

    startRound() {
        this.generateDeck();
        this.rows = [[], [], [], []];

        // Deal 4 cards to rows
        for (let i = 0; i < 4; i++) {
            this.rows[i].push(this.deck.pop());
        }

        // Deal 10 cards to each player
        for (let socketId in this.players) {
            this.players[socketId].hand = [];
            for (let i = 0; i < 10; i++) {
                this.players[socketId].hand.push(this.deck.pop());
            }
            // Sort hand strictly numeric
            this.players[socketId].hand.sort((a, b) => a.number - b.number);
        }

        this.gameState = 'selecting_cards';
        this.round++;
    }

    // Helper to get public state for clients
    getPublicState() {
        return {
            rows: this.rows,
            players: Object.values(this.players).map(p => ({
                id: p.id,
                name: p.name,
                score: p.score,
                handSize: p.hand.length,
                hasPlayed: this.playedCards.some(pc => pc.socketId === p.id)
            })),
            gameState: this.gameState,
            playedCards: this.gameState === 'revealing' || this.gameState === 'resolving' ? this.playedCards : [],
            currentResolvingCard: this.gameState === 'resolving' && this.playedCards[this.resolutionIndex] ? this.playedCards[this.resolutionIndex] : null,
            pendingRowChoice: this.pendingRowChoice,
            hostId: this.hostId
        };
    }

    playCard(socketId, cardNumber) {
        const player = this.players[socketId];
        if (!player) return false;

        // Check if player has card
        const cardIndex = player.hand.findIndex(c => c.number === cardNumber);
        if (cardIndex === -1) return false;

        // Check if already played
        if (this.playedCards.some(pc => pc.socketId === socketId)) return false;

        const card = player.hand.splice(cardIndex, 1)[0];
        this.playedCards.push({ socketId, card });
        return true;
    }

    checkTurnReady() {
        return this.playedCards.length === Object.keys(this.players).length;
    }

    resolveTurn() {
        this.gameState = 'resolving';
        // Sort played cards by number ascending
        this.playedCards.sort((a, b) => a.card.number - b.card.number);
        this.resolutionIndex = 0;
        // Do not auto-start, server will call processNextStep
        return { type: 'resolving_start' };
    }

    processNextStep() {
        if (this.resolutionIndex >= this.playedCards.length) {
            // End of turn
            this.prepareNextTurn();
            return { type: 'turnComplete' };
        }

        const currentPlay = this.playedCards[this.resolutionIndex];
        const card = currentPlay.card;
        const socketId = currentPlay.socketId;

        // Find best row
        let bestRowIndex = -1;
        let minDiff = 105; // Max possible diff is < 104

        for (let i = 0; i < 4; i++) {
            const lastCard = this.rows[i][this.rows[i].length - 1];
            if (card.number > lastCard.number) {
                const diff = card.number - lastCard.number;
                if (diff < minDiff) {
                    minDiff = diff;
                    bestRowIndex = i;
                }
            }
        }

        // Case C: Card too low (lower than all row ends)
        if (bestRowIndex === -1) {
            this.pendingRowChoice = socketId;
            return { type: 'requestRowChoice', socketId: socketId };
        }

        // Case A or B
        const targetRow = this.rows[bestRowIndex];
        let rowTaken = false;
        let pointsTaken = 0;

        // Case B: Row full (5 cards -> 6th card)
        if (targetRow.length === 5) {
            pointsTaken = this.scoreRow(socketId, bestRowIndex);
            this.rows[bestRowIndex] = [card]; // Replace row with new card
            rowTaken = true;
        } else {
            // Case A: Just add card
            targetRow.push(card);
        }

        // Proceed to next card index for NEXT call, but we are done for this step
        this.resolutionIndex++;

        return {
            type: 'stepComplete',
            payload: {
                socketId,
                player: this.players[socketId],
                rowTaken,
                pointsTaken,
                card
            }
        };
    }

    handleRowChoice(socketId, rowIndex) {
        if (this.pendingRowChoice !== socketId) return { error: 'Not your turn to choose' };
        if (rowIndex < 0 || rowIndex > 3) return { error: 'Invalid row' };

        const currentPlay = this.playedCards[this.resolutionIndex];

        // Player takes the chosen row
        const pointsTaken = this.scoreRow(socketId, rowIndex);

        // Their card replaces the row
        this.rows[rowIndex] = [currentPlay.card];

        this.pendingRowChoice = null;
        this.resolutionIndex++;

        return {
            type: 'stepComplete',
            payload: {
                socketId,
                player: this.players[socketId],
                rowTaken: true, // Always takes row in this case
                pointsTaken,
                card: currentPlay.card
            }
        };
    }

    scoreRow(socketId, rowIndex) {
        const row = this.rows[rowIndex];
        let info = `Player ${this.players[socketId].name} took row ${rowIndex} (${row.length} cards).`;
        let points = 0;
        for (const c of row) {
            points += c.bullheads;
            this.players[socketId].scorePile.push(c);
        }
        this.players[socketId].score += points;
        return points;
    }

    prepareNextTurn() {
        this.playedCards = [];
        this.pendingRowChoice = null;
        this.gameState = 'selecting_cards';

        // Check round end
        if (this.players[Object.keys(this.players)[0]].hand.length === 0) {
            this.gameState = 'round_end';
            // Here we would check for game end (66 points)
        }
    }
}

module.exports = { Card, Game };
