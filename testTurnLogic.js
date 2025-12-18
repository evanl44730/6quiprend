const { Game, Card } = require('./gameLogic');

function runTests() {
    console.log("=== Testing Game Logic ===");
    const game = new Game();
    game.addPlayer('p1', 'Alice');
    game.addPlayer('p2', 'Bob');
    game.startRound();
    console.log("[PASS] Round started.");

    // -- Mock Setup for specific scenarios --
    // Clear hands and rows to test specific logic
    game.rows = [
        [new Card(10)], // Ends in 10
        [new Card(20)], // Ends in 20
        [new Card(30)], // Ends in 30
        [new Card(40)]  // Ends in 40
    ];

    // Test Case A: Normal Gameplay
    console.log("\n-- Test Case A: Normal Placement --");
    game.gameState = 'selecting_cards';
    // Alice plays 12 (should go to row 0, diff 2)
    // Bob plays 42 (should go to row 3, diff 2)
    game.players['p1'].hand = [new Card(12)];
    game.players['p2'].hand = [new Card(42)];

    game.playCard('p1', 12);
    game.playCard('p2', 42);

    if (!game.checkTurnReady()) console.error("[FAIL] Turn should be ready");

    game.resolveTurn();

    if (game.rows[0].length === 2 && game.rows[0][1].number === 12) console.log("[PASS] 12 placed correctly.");
    else console.error("[FAIL] 12 placement error:", game.rows);

    if (game.rows[3].length === 2 && game.rows[3][1].number === 42) console.log("[PASS] 42 placed correctly.");
    else console.error("[FAIL] 42 placement error:", game.rows);


    // Test Case B: 6th Card Overflow
    console.log("\n-- Test Case B: 6th Card Overflow --");
    game.prepareNextTurn(); // reset
    // Fill row 1 to 5 cards
    game.rows[1] = [new Card(20), new Card(21), new Card(22), new Card(23), new Card(24)]; // Ends in 24

    // Alice plays 26 (should go to row 1, become 6th -> take row)
    game.players['p1'].hand = [new Card(26)];
    game.players['p2'].hand = [new Card(100)]; // Irrelevant high card

    game.playCard('p1', 26);
    game.playCard('p2', 100);
    game.resolveTurn();

    // Row 1 should now be just [26]
    if (game.rows[1].length === 1 && game.rows[1][0].number === 26) console.log("[PASS] Row collected and replaced by 26.");
    else console.error("[FAIL] Overflow logic error:", game.rows[1]);

    // Alice score check: 20(3)+21(1)+22(5)+23(1)+24(1) = 11 bullheads
    if (game.players['p1'].score > 0) console.log(`[PASS] Alice collected points: ${game.players['p1'].score}`);
    else console.error("[FAIL] Score not updated.");


    // Test Case C: Card Too Low
    console.log("\n-- Test Case C: Card Too Low (Undercut) --");
    game.prepareNextTurn();
    game.rows = [
        [new Card(10)],
        [new Card(20)],
        [new Card(30)],
        [new Card(40)]
    ];

    // Alice plays 5 (lower than all 10,20,30,40)
    game.players['p1'].hand = [new Card(5)];
    game.players['p2'].hand = [new Card(100)];

    game.playCard('p1', 5);
    game.playCard('p2', 100);

    const result = game.resolveTurn();

    if (result.type === 'requestRowChoice' && result.socketId === 'p1') console.log("[PASS] Requested row choice from Alice.");
    else console.error("[FAIL] Did not request row choice:", result);

    // Alice chooses row 2 (Card 30 - 3 heads)
    console.log(" Simonulating Alice choosing row 2...");
    const choiceResult = game.handleRowChoice('p1', 2);

    if (game.rows[2].length === 1 && game.rows[2][0].number === 5) console.log("[PASS] Row 2 replaced by 5.");
    else console.error("[FAIL] Row replacement failed:", game.rows[2]);

    console.log("\nAll Tests Completed.");
}

runTests();
