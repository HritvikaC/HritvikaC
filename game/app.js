const apiOrigin = (window.CONNECT4_API_ORIGIN || "").replace(/\/$/, "");
const state = { snapshot: null, session: null, busy: false };
const boardElement = document.querySelector("#board");
const statusElement = document.querySelector("#status");
const accountElement = document.querySelector("#account");
const turnElement = document.querySelector("#turn");
const lastMoveElement = document.querySelector("#last-move");
const resetButton = document.querySelector("#reset");
const errorElement = document.querySelector("#error");

function setError(message = "") {
  errorElement.hidden = !message;
  errorElement.textContent = message;
}
function api(path, options = {}) {
  if (!apiOrigin || apiOrigin.includes("REPLACE-WITH-YOUR"))
    return Promise.reject(
      new Error("The game backend has not been configured yet."),
    );
  return fetch(`${apiOrigin}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  });
}
function renderAccount() {
  accountElement.replaceChildren();
  if (!state.session) {
    const link = document.createElement("a");
    link.href = `${apiOrigin}/auth/github`;
    link.textContent = "Sign in with GitHub";
    accountElement.append(link);
    return;
  }
  const image = document.createElement("img");
  image.src = state.session.avatarUrl;
  image.alt = "";
  const name = document.createElement("span");
  name.textContent = `@${state.session.login}`;
  const logout = document.createElement("button");
  logout.type = "button";
  logout.textContent = "Log out";
  logout.onclick = () =>
    api("/auth/logout", { method: "POST" }).then(() => {
      state.session = null;
      renderAccount();
      render();
    });
  accountElement.append(image, name, logout);
}
function render() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  boardElement.replaceChildren();
  snapshot.board.forEach((row, rowIndex) =>
    row.forEach((value, columnIndex) => {
      const cell = document.createElement("button");
      cell.className = `cell ${value === 1 ? "red" : value === 2 ? "yellow" : ""}`;
      cell.type = "button";
      cell.disabled = state.busy || Boolean(snapshot.winner) || !state.session;
      cell.title = state.session
        ? `Drop in column ${columnIndex + 1}`
        : "Sign in to play";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute(
        "aria-label",
        `Row ${rowIndex + 1}, column ${columnIndex + 1}`,
      );
      cell.onclick = () => move(columnIndex);
      boardElement.append(cell);
    }),
  );
  statusElement.textContent = snapshot.winner
    ? `Game over: ${snapshot.winner.login} wins.`
    : snapshot.draw
      ? "Game over: draw."
      : state.session
        ? `You are @${state.session.login}.`
        : "Sign in with GitHub to make a move.";
  turnElement.textContent =
    snapshot.winner || snapshot.draw
      ? "Start a new game when you are ready."
      : `Turn ${snapshot.turn === 1 ? "red" : "yellow"}`;
  resetButton.hidden = !(snapshot.winner || snapshot.draw) || !state.session;
  lastMoveElement.replaceChildren();
  if (snapshot.lastPlayer) {
    const image = document.createElement("img");
    image.className = "avatar";
    image.src = snapshot.lastPlayer.avatarUrl;
    image.alt = "";
    const text = document.createElement("span");
    text.textContent = `@${snapshot.lastPlayer.login}`;
    lastMoveElement.append(image, text);
  } else lastMoveElement.textContent = "No moves yet";
}
async function move(column) {
  if (state.busy) return;
  state.busy = true;
  setError();
  render();
  try {
    state.snapshot = await api("/api/game/moves", {
      method: "POST",
      body: JSON.stringify({ column }),
    });
  } catch (error) {
    setError(error.message);
  } finally {
    state.busy = false;
    render();
  }
}
async function refresh() {
  try {
    const [session, snapshot] = await Promise.all([
      api("/api/session"),
      api("/api/game"),
    ]);
    state.session = session.user;
    state.snapshot = snapshot;
    renderAccount();
    render();
    setError();
  } catch (error) {
    setError(error.message);
    statusElement.textContent = "Unable to reach the game backend.";
  }
}
resetButton.onclick = async () => {
  try {
    state.snapshot = await api("/api/game/reset", { method: "POST" });
    render();
  } catch (error) {
    setError(error.message);
  }
};
refresh();
setInterval(
  () =>
    api("/api/game")
      .then((snapshot) => {
        state.snapshot = snapshot;
        render();
      })
      .catch(() => {}),
  4000,
);
