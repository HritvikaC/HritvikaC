export const ROWS = 6;
export const COLUMNS = 7;

export function newGame() {
  return {
    board: Array.from({ length: ROWS }, () => Array(COLUMNS).fill(0)),
    turn: 1,
    players: {},
    winner: null,
    draw: false,
    lastPlayer: null,
  };
}

export function dropPiece(snapshot, column, player) {
  if (!Number.isInteger(column) || column < 0 || column >= COLUMNS)
    throw new Error("Choose a valid column.");
  if (snapshot.winner || snapshot.draw) throw new Error("This game is over.");
  if (snapshot.turn !== player) throw new Error("It is not your turn.");
  let row = ROWS - 1;
  while (row >= 0 && snapshot.board[row][column] !== 0) row -= 1;
  if (row < 0) throw new Error("That column is full.");
  snapshot.board[row][column] = player;
  if (hasWon(snapshot.board, row, column, player)) snapshot.winner = player;
  else if (snapshot.board[0].every(Boolean)) snapshot.draw = true;
  else snapshot.turn = player === 1 ? 2 : 1;
  return { row, snapshot };
}

export function hasWon(board, row, column, player) {
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  return directions.some(
    ([dr, dc]) =>
      1 +
        count(board, row, column, dr, dc, player) +
        count(board, row, column, -dr, -dc, player) >=
      4,
  );
}

function count(board, row, column, rowStep, columnStep, player) {
  let total = 0;
  for (
    let r = row + rowStep, c = column + columnStep;
    r >= 0 && r < ROWS && c >= 0 && c < COLUMNS && board[r][c] === player;
    r += rowStep, c += columnStep
  )
    total += 1;
  return total;
}
