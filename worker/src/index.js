import { dropPiece, newGame } from "./game.js";

const COOKIE = "connect4_session";
const STATE_COOKIE = "connect4_oauth_state";
const FRONTEND = (env) => env.FRONTEND_ORIGIN || "http://localhost:8788";

function cors(env, response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", FRONTEND(env));
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return new Response(response.body, { status: response.status, headers });
}
function json(env, data, status = 200, headers = {}) {
  return cors(
    env,
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    }),
  );
}
function redirect(env, location, headers = {}) {
  return cors(
    env,
    new Response(null, {
      status: 302,
      headers: { Location: location, ...headers },
    }),
  );
}
function proxy(env, response) {
  return cors(env, response);
}
function base64(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function decode(value) {
  return Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=="),
    (character) => character.charCodeAt(0),
  );
}
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
}
async function sign(value, secret) {
  return `${value}.${base64(await hmac(value, secret))}`;
}
async function verify(token, secret) {
  const [value, signature] = token.split(".");
  if (!value || !signature) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return (await crypto.subtle.verify(
    "HMAC",
    key,
    decode(signature),
    new TextEncoder().encode(value),
  ))
    ? JSON.parse(new TextDecoder().decode(decode(value)))
    : null;
}
function cookies(request) {
  return Object.fromEntries(
    (request.headers.get("Cookie") || "")
      .split(";")
      .filter(Boolean)
      .map((part) => part.trim().split(/=(.*)/s)),
  );
}
function cookie(name, value, maxAge) {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=None`;
}
function authUser(request, env) {
  const token = cookies(request)[COOKIE];
  return token ? verify(token, env.SESSION_SECRET) : Promise.resolve(null);
}
function gameStub(env) {
  return env.GAME.get(env.GAME.idFromName("public"));
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return cors(env, new Response(null, { status: 204 }));
    const url = new URL(request.url);
    try {
      if (url.pathname === "/auth/github") {
        const state = crypto.randomUUID();
        const params = new URLSearchParams({
          client_id: env.GITHUB_CLIENT_ID,
          redirect_uri: `${url.origin}/auth/callback`,
          scope: "read:user",
          state,
        });
        return redirect(
          env,
          `https://github.com/login/oauth/authorize?${params}`,
          { "Set-Cookie": cookie(STATE_COOKIE, state, 600) },
        );
      }
      if (url.pathname === "/auth/callback") {
        const expected = cookies(request)[STATE_COOKIE];
        if (!expected || expected !== url.searchParams.get("state"))
          return json(env, { error: "Invalid OAuth state." }, 400);
        const tokenResponse = await fetch(
          "https://github.com/login/oauth/access_token",
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              client_id: env.GITHUB_CLIENT_ID,
              client_secret: env.GITHUB_CLIENT_SECRET,
              code: url.searchParams.get("code"),
              redirect_uri: `${url.origin}/auth/callback`,
            }),
          },
        );
        const token = (await tokenResponse.json()).access_token;
        const githubResponse = await fetch("https://api.github.com/user", {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "User-Agent": "HritvikaC-connect4",
          },
        });
        if (!githubResponse.ok)
          return json(env, { error: "GitHub authentication failed." }, 502);
        const githubUser = await githubResponse.json();
        const identity = JSON.stringify({
          id: githubUser.id,
          login: githubUser.login,
          avatarUrl: githubUser.avatar_url,
        });
        const signed = await sign(
          base64(new TextEncoder().encode(identity)),
          env.SESSION_SECRET,
        );
        return redirect(env, FRONTEND(env), {
          "Set-Cookie": `${cookie(COOKIE, signed, 604800)}; ${cookie(STATE_COOKIE, "", 0)}`,
        });
      }
      if (url.pathname === "/auth/logout")
        return json(env, { ok: true }, 200, {
          "Set-Cookie": cookie(COOKIE, "", 0),
        });
      if (url.pathname === "/api/session")
        return json(env, { user: await authUser(request, env) });
      if (url.pathname === "/api/game" && request.method === "GET")
        return proxy(env, await gameStub(env).fetch("https://game/state"));
      if (url.pathname === "/api/game/moves" && request.method === "POST")
        return proxy(
          env,
          await gameStub(env).fetch("https://game/moves", {
            method: "POST",
            headers: {
              "X-User": JSON.stringify(await authUser(request, env)),
              "Content-Type": "application/json",
            },
            body: await request.text(),
          }),
        );
      if (url.pathname === "/api/game/reset" && request.method === "POST")
        return proxy(
          env,
          await gameStub(env).fetch("https://game/reset", {
            method: "POST",
            headers: { "X-User": JSON.stringify(await authUser(request, env)) },
          }),
        );
      return json(env, { error: "Not found." }, 404);
    } catch (error) {
      return json(
        env,
        { error: error.message || "Unexpected server error." },
        500,
      );
    }
  },
};

export class GameLobby {
  constructor(state) {
    this.state = state;
    this.storage = state.storage;
    this.connections = new Set();
  }
  async load() {
    return (await this.storage.get("game")) || newGame();
  }
  async save(game) {
    await this.storage.put("game", game);
    return game;
  }
  response(game, status = 200) {
    return new Response(JSON.stringify(game), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const game = await this.load();
    if (path === "/state") return this.response(game);
    const user = JSON.parse(request.headers.get("X-User") || "null");
    if (!user)
      return this.response({ error: "Sign in with GitHub to play." }, 401);
    if (path === "/reset") {
      if (!game.winner && !game.draw)
        return this.response(
          { error: "A game can only be reset after it ends." },
          409,
        );
      return this.response(await this.save(newGame()));
    }
    if (path !== "/moves") return this.response({ error: "Not found." }, 404);
    let player = Object.entries(game.players).find(
      ([, identity]) => identity.id === user.id,
    )?.[0];
    if (!player) {
      if (Object.keys(game.players).length >= 2)
        return this.response(
          { error: "This lobby already has two players." },
          409,
        );
      player = String(Object.keys(game.players).length + 1);
      game.players[player] = user;
    }
    try {
      const body = await request.json();
      dropPiece(game, Number(body.column), Number(player));
    } catch (error) {
      return this.response({ error: error.message }, 409);
    }
    game.lastPlayer = user;
    return this.response(await this.save(game));
  }
}
