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

// State
let myHand = [];
let isSelectingRow = false;

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

    // 3. Render Rows
    state.rows.forEach((rowCards, index) => {
        const rowDiv = rowDivs[index];
        rowDiv.innerHTML = '';
        rowCards.forEach(cardData => {
            rowDiv.appendChild(createCardElement(cardData));
        });

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
