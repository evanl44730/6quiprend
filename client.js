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
let isAnimating = false;

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

    // 2. Render Players
    playersList.innerHTML = '';
    state.players.forEach(p => {
        const div = document.createElement('div');
        div.className = `player-tag ${p.hasPlayed && state.gameState === 'selecting_cards' ? 'has-played' : ''}`;
        div.innerText = `${p.name}: ${p.score} 🐮`;
        playersList.appendChild(div);
    });

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
    handContainer.innerHTML = '';
    myHand.forEach(card => {
        const cardEl = createCardElement(card);
        cardEl.classList.add('clickable');
        cardEl.onclick = () => {
            if (!isSelectingRow) { // Can't play if choosing row
                socket.emit('playCard', card.number);
                // Optimistic remove? No, wait for server update
                cardEl.style.opacity = '0.5';
            }
        };
        handContainer.appendChild(cardEl);
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

    // Simple strategy: 
    // 1. Remove extras
    // 2. Update/Append existing

    // Actually simpler for this game: 
    // Cards only append, or row clears.

    if (cards.length === 0 && currentChildren.length > 0) {
        rowDiv.innerHTML = ''; // Row taken/reset
        return;
    }

    // If cards appended
    if (cards.length > currentChildren.length) {
        for (let i = currentChildren.length; i < cards.length; i++) {
            const newCard = createCardElement(cards[i]);
            // Add ID for tracking
            newCard.dataset.number = cards[i].number;
            // newCard.style.opacity = '0'; // Start hidden for animation?
            rowDiv.appendChild(newCard);
        }
    }
    // Handle edge case if row changes completely (should verify numbers)
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
        label.innerText = pc.player;
        label.style.position = 'absolute';
        label.style.bottom = '-20px';
        label.style.fontSize = '12px';
        label.style.color = 'white';
        label.style.width = '100%';
        label.style.textAlign = 'center';
        cardEl.appendChild(label);

        playedCenterDiv.appendChild(cardEl);
    });
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
