// Connection Setup
const hostname = window.location.hostname;
let SERVER_URL;

if (hostname === 'localhost' || hostname === '127.0.0.1') {
    SERVER_URL = 'http://localhost:3000';
} else {
    // Replace this with your actual Render backend URL later
    SERVER_URL = 'https://sixquiprend.onrender.com';
}

const socket = io(SERVER_URL);


// DOM Elements
const loginScreen = document.getElementById('login-screen');
const gameScreen = document.getElementById('game-screen');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const startBtn = document.getElementById('game-start-btn');
const statusArea = document.getElementById('game-phase');
const overlayMsg = document.getElementById('overlay-message');
const playersList = document.getElementById('players-list');
const boardDiv = document.getElementById('board');
const handContainer = document.getElementById('hand-container');
const rowDivs = [
    document.getElementById('row-0'),
    document.getElementById('row-1'),
    document.getElementById('row-2'),
    document.getElementById('row-3')
];

// Add Toast Container
const toastDiv = document.createElement('div');
toastDiv.id = 'toast';
document.body.appendChild(toastDiv);

// Staging Area
const playedCenterDiv = document.createElement('div');
playedCenterDiv.id = 'played-center';
document.body.appendChild(playedCenterDiv);

// State
let myHand = [];
let isSelectingRow = false;
let previousRowsState = [[], [], [], []]; // For diffing
let currentRows = [[], [], [], []]; // For prediction logic
let isAnimating = false;
let hasPlayed = false; // Prevent multiple clicks

// Join Game
joinBtn.addEventListener('click', () => {
    const name = usernameInput.value;
    if (name) {
        socket.emit('joinGame', name);
        loginScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
    }
});

startBtn.addEventListener('click', () => {
    socket.emit('startGame');
    startBtn.classList.add('hidden');
});

// Socket Events
socket.on('gameState', (state) => {
    renderGame(state);
});

socket.on('hand', (hand) => {
    myHand = hand;
    renderHand();
});

socket.on('playUpdate', () => {
    // Optional: could play a sound
});

socket.on('newTurn', () => {
    hasPlayed = false; // Reset for next turn
    renderHand(); // Re-render to enable clicks
});

socket.on('rowTaken', (data) => {
    // Visual Feedback
    document.body.classList.add('flash-red');
    showToast(`${data.player} a ramassé ${data.points} têtes de taureau ! 🐮`);

    setTimeout(() => {
        document.body.classList.remove('flash-red');
    }, 500);
});

socket.on('requestRowChoice', () => {
    isSelectingRow = true;
    overlayMsg.innerText = "⚠️ Votre carte est trop petite ! Cliquez sur une rangée pour la ramasser.";
    overlayMsg.classList.remove('hidden');

    // Highlight rows
    rowDivs.forEach(div => div.classList.add('selectable'));
});

socket.on('error', (msg) => {
    alert(msg);
});

socket.on('roundEnd', (data) => {
    showToast(`Fin de la manche ! La prochaine commence dans ${data.seconds}s... ⏳`);
});

socket.on('newRound', () => {
    hasPlayed = false; // Reset state
    showToast("Nouvelle manche ! 🃏");
    document.body.style.background = "#2ecc71"; // Quick green flash
    setTimeout(() => { document.body.style.background = ""; }, 300);
});

socket.on('gameOver', (winner) => {
    let msg = `GAME OVER ! 👑 Vainqueur : ${winner.name} (${winner.score} pts)`;
    overlayMsg.innerHTML = `<h1>${msg}</h1><p>Les autres ont dépassé 66 têtes de bœufs !</p>`;

    // Add reset button for everyone, but logic checks host
    const resetBtn = document.createElement('button');
    resetBtn.innerText = "Retour au menu";
    resetBtn.style.marginTop = "20px";
    resetBtn.style.padding = "10px 20px";
    resetBtn.style.fontSize = "1.2rem";
    resetBtn.style.cursor = "pointer";
    resetBtn.onclick = () => {
        socket.emit('resetGame');
        location.reload(); // Simple reload for now to clear state
    };

    overlayMsg.appendChild(resetBtn);
    overlayMsg.classList.remove('hidden');
});

// Rendering Logic

function renderGame(state) {
    // 1. Render Status
    let statusText = `Phase: ${state.gameState} | `;
    if (state.gameState === 'selecting_cards') statusText += "Choisissez une carte...";
    else if (state.gameState === 'resolving') statusText += "Résolution en cours...";

    statusArea.innerText = statusText;

    // Show/Hide Start Button based on Host
    if (state.gameState === 'waiting' && state.hostId === socket.id) {
        startBtn.classList.remove('hidden');
    } else {
        startBtn.classList.add('hidden');
    }

    // Remove overlay if not choosing row
    if (state.pendingRowChoice !== socket.id) {
        isSelectingRow = false;
        overlayMsg.classList.add('hidden');
        rowDivs.forEach(div => div.classList.remove('selectable'));
    }

    // Spectator Handling
    const currentPlayer = state.players.find(p => p.id === socket.id);
    let banner = document.getElementById('spectator-banner');

    if (currentPlayer && currentPlayer.isSpectator) {
        handContainer.classList.add('hidden');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'spectator-banner';
            banner.innerText = 'Mode Spectateur - Partie en cours';
            document.body.appendChild(banner);
        }
    } else {
        handContainer.classList.remove('hidden');
        if (banner) banner.remove();
        renderHand();
    }

    // 2. Render Players
    playersList.innerHTML = '';
    state.players.forEach(p => {
        const div = document.createElement('div');
        div.className = `player-tag ${p.hasPlayed && state.gameState === 'selecting_cards' ? 'has-played' : ''}`;

        let avatarHtml = `<img src="${getAvatarUrl(p.name)}" class="avatar" alt="avatar">`;
        let spectatorHtml = p.isSpectator ? '<span class="spectator-icon" title="Spectateur">👁️</span>' : '';
        div.innerHTML = `${avatarHtml} <span>${p.name}: ${p.score} 🐮</span>${spectatorHtml}`;

        playersList.appendChild(div);
    });

    // Save current rows for prediction
    currentRows = state.rows;

    // 3. Render Rows with Smart Diffing (No Flicker) & Animation Trigger
    state.rows.forEach((rowCards, index) => {
        const rowDiv = rowDivs[index];
        // Identify new cards for animation
        const prevRow = previousRowsState[index] || [];
        const newCards = rowCards.slice(prevRow.length);

        // Sync DOM
        syncRow(rowDiv, rowCards);

        // If new cards arrived, check if they match any played card in center
        // and trigger animation
        newCards.forEach(cardData => {
            // Find the card element in the row
            const cardEl = Array.from(rowDiv.children).find(el =>
                el.innerText.includes(cardData.number) // Rough check, better with data-id
            );

            if (cardEl) {
                // Check if this card was in center?
                // Actually, let's just animate from center if it's a resolving phase
                if (state.gameState === 'resolving') {
                    // Find matching card in played center (if it exists)
                    const centerCard = Array.from(playedCenterDiv.children).find(el =>
                        el.innerText.includes(cardData.number)
                    );

                    if (centerCard) {
                        animateCardMove(centerCard, cardEl);
                    }
                }
            }
        });

        // Update previous state
        previousRowsState[index] = [...rowCards];

        // Click handler for row selection
        rowDiv.onclick = () => {
            if (isSelectingRow) {
                socket.emit('chooseRow', index);
                isSelectingRow = false;
                overlayMsg.classList.add('hidden');
                rowDivs.forEach(d => d.classList.remove('selectable'));
            }
        };
    });

    // 4. Render Played Cards (Center Staging)
    renderPlayedCenter(state.playedCards);
}

function renderHand() {
    // Smart Diffing for Hand
    const currentCardEls = Array.from(handContainer.children);
    const newCardNumbers = myHand.map(c => c.number);

    // 1. Remove cards not in hand
    currentCardEls.forEach(el => {
        const num = parseInt(el.dataset.number);
        if (!newCardNumbers.includes(num)) {
            el.remove();
        }
    });

    // 2. Add new cards / Update existing
    myHand.forEach(card => {
        let cardEl = currentCardEls.find(el => parseInt(el.dataset.number) === card.number);

        if (!cardEl) {
            // New card
            cardEl = createCardElement(card);
            cardEl.dataset.number = card.number;

            // Add click listener (only once on creation)
            cardEl.onclick = () => {
                if (!isSelectingRow && !hasPlayed) {
                    socket.emit('playCard', card.number);
                    hasPlayed = true;

                    // Visual feedback
                    cardEl.style.opacity = '0.5';
                    cardEl.classList.add('played');
                    renderHand(); // Trigger update to lock others

                    // Clear highlights
                    clearHighlights();
                }
            };

            // Hover effects (Visual Aid)
            cardEl.onmouseenter = () => {
                if (!isSelectingRow && !hasPlayed) {
                    highlightPredictedRow(card.number);
                }
            };

            cardEl.onmouseleave = () => {
                clearHighlights();
            };

            // Insert in correct order?
            // Hands are sorted by server, so appending usually works if we process in order.
            // Since "remove" happened first, we just append new ones. 
            // A perfect sort sync is harder but appending sorted hand usually works fine for this game.
            handContainer.appendChild(cardEl);
        }


        // Update State & Reset Visuals (Important for diffing!)
        cardEl.className = `card type-${getCardType(card.bullheads, card.number)} clickable`;

        // If this specific card was just clicked by us, keep it gray.
        // But since we use 'hasPlayed' for logic, we can just check if it's "played" class
        // Actually, we should CLEAN styles by default, unless it's the one we just clicked?
        // Simpler: If hasPlayed is true, maybe gray everything? Or just blocks clicks.
        // User asked for "others are grayed". Let's focus on blocking clicks first.

        // Reset style always to be safe against persistence
        if (!cardEl.classList.contains('played')) {
            cardEl.style.opacity = '1';
            cardEl.style.cursor = 'pointer';
        }

        // Lock clicks if already played
        if (hasPlayed && !cardEl.classList.contains('played')) {
            cardEl.style.cursor = 'not-allowed';
            cardEl.style.opacity = '0.7'; // Visual feedback that you can't click
        }
    });
}

// Helper: Create HTML for a card
function createCardElement(card) {
    const el = document.createElement('div');
    el.className = `card type-${getCardType(card.bullheads, card.number)}`;

    // Top Icons
    const topDiv = document.createElement('div');
    topDiv.className = 'card-top';
    topDiv.innerText = '🐮'.repeat(card.bullheads);

    // Center Number
    const centerDiv = document.createElement('div');
    centerDiv.className = 'card-center';
    centerDiv.innerText = card.number;

    // Bottom Icons
    const bottomDiv = document.createElement('div');
    bottomDiv.className = 'card-bottom';
    bottomDiv.innerText = '🐮'.repeat(card.bullheads);

    el.appendChild(topDiv);
    el.appendChild(centerDiv);
    el.appendChild(bottomDiv);

    return el;
}

// Smart Diffing for Rows
function syncRow(rowDiv, cards) {
    const currentChildren = Array.from(rowDiv.children);

    // If row cleared or reduced size (taken), or entirely different start
    // We must reset. Diffing is hard when "taking a row".
    // Simple heuristic: if length decreased, OR first card doesn't match, full reset.
    // (In 6 qui prend, rows only grow, UNLESS taken).

    let shouldReset = false;
    if (cards.length < currentChildren.length) shouldReset = true;
    else if (cards.length > 0 && currentChildren.length > 0) {
        const firstDom = parseInt(currentChildren[0].dataset.number);
        if (firstDom !== cards[0].number) shouldReset = true;
    }

    if (shouldReset) {
        rowDiv.innerHTML = '';
        cards.forEach(card => {
            const newCard = createCardElement(card);
            newCard.dataset.number = card.number;
            rowDiv.appendChild(newCard);
        });
        return;
    }

    // If we are here, we are just appending new cards
    if (cards.length > currentChildren.length) {
        for (let i = currentChildren.length; i < cards.length; i++) {
            const newCard = createCardElement(cards[i]);
            newCard.dataset.number = cards[i].number;
            rowDiv.appendChild(newCard);
        }
    }
}

function renderPlayedCenter(playedCards) {
    // Sync center div
    // We only care about showing cards that are NOT yet in rows
    // But server clears playedCards as they move to rows?
    // Actually server logic: processNextStep moves card from playedCards to row.
    // So if it's in playedCards, it's in center.

    playedCenterDiv.innerHTML = '';
    playedCards.forEach(pc => {
        const cardEl = createCardElement(pc.card);
        cardEl.dataset.owner = pc.player; // Maybe show name?
        // Add a small label for who played it?
        const label = document.createElement('div');
        label.className = 'played-label';

        const avatarUrl = getAvatarUrl(pc.player);
        label.innerHTML = `<img src="${avatarUrl}" class="avatar-small"> ${pc.player}`;

        cardEl.appendChild(label);

        playedCenterDiv.appendChild(cardEl);
    });
}

function highlightPredictedRow(cardNumber) {
    clearHighlights();

    let bestRowIndex = -1;
    let minDiff = 105;

    currentRows.forEach((row, index) => {
        if (row.length === 0) return; // Should not happen in game flow
        const lastCard = row[row.length - 1];

        if (cardNumber > lastCard.number) {
            const diff = cardNumber - lastCard.number;
            if (diff < minDiff) {
                minDiff = diff;
                bestRowIndex = index;
            }
        }
    });

    if (bestRowIndex !== -1) {
        // Valid placement
        rowDivs[bestRowIndex].classList.add('highlight-target');
    } else {
        // Too small! Danger!
        rowDivs.forEach(div => div.classList.add('highlight-danger'));
    }
}

function clearHighlights() {
    rowDivs.forEach(div => {
        div.classList.remove('highlight-target');
        div.classList.remove('highlight-danger');
    });
}

function getAvatarUrl(name) {
    // Determine seed from name or just use name directly
    // Using 'bottts' as requested for robot style
    // You can also use 'adventurer' or 'fun-emoji'
    const seed = encodeURIComponent(name);
    return `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}&backgroundColor=transparent`;
}

function animateCardMove(startEl, endEl) {
    // FLIP Animation
    // First: Get start position
    const startRect = startEl.getBoundingClientRect();

    // Last: Get end position
    const endRect = endEl.getBoundingClientRect();

    // Invert: Calculate difference
    const deltaX = startRect.left - endRect.left;
    const deltaY = startRect.top - endRect.top;
    const scaleX = startRect.width / endRect.width; // Should be 1

    // Clone the element to animate (so we don't mess up the grid flow)
    const flyingCard = startEl.cloneNode(true);
    flyingCard.classList.add('card-moving');

    // Set initial position (End position + Delta) -> This puts it visually at Start
    flyingCard.style.top = `${endRect.top}px`;
    flyingCard.style.left = `${endRect.left}px`;
    flyingCard.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

    document.body.appendChild(flyingCard);

    // Hide original until animation done
    endEl.classList.add('hidden-card');

    // Force Reflow
    flyingCard.offsetHeight;

    // Play: Remove transform to letting it slide to 0,0 (End)
    flyingCard.style.transform = `translate(0, 0)`;

    // Cleanup
    setTimeout(() => {
        flyingCard.remove();
        endEl.classList.remove('hidden-card');
    }, 600); // Match CSS transition time
}

function getCardType(bullheads, number) {
    if (number === 55) return 7;
    if (bullheads >= 5) return 5;
    if (bullheads === 1) return 1;
    return 2; // For 2 or 3 bullheads (teal/green)
}

function showToast(message) {
    toastDiv.innerText = message;
    toastDiv.className = "show";
    setTimeout(function () { toastDiv.className = toastDiv.className.replace("show", ""); }, 3000);
}
