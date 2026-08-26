const WebSocket = require("ws");

// Maintains one outbound connection to notify-server, reconnecting with
// backoff on any drop (network blip, laptop sleep/wake, server restart).
// Never gives up — this is meant to run for the lifetime of the app.
class ReconnectingClient {
  // getToken: async () => { accessToken, user } | { needsLogin: true } —
  // called fresh on every (re)connect attempt so a token refreshed (or a
  // login completed) since the last attempt is always picked up.
  constructor({ url, getToken, onEvent, onStatus }) {
    this.url = url;
    this.getToken = getToken;
    this.onEvent = onEvent;
    this.onStatus = onStatus ?? (() => {});
    this.ws = null;
    this.stopped = false;
    this.backoffMs = 1000;
    this.maxBackoffMs = 30_000;
  }

  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
  }

  async _connect() {
    if (this.stopped) return;

    this.onStatus("connecting");
    const auth = await this.getToken();
    if (this.stopped) return;
    if (auth.needsLogin) {
      // Not logged in (or the refresh token was itself revoked/expired) —
      // retrying on a timer won't fix this, only the person logging in
      // will. Surfaced the same way a bad secret used to be.
      this.onStatus("unauthorized", "ยังไม่ได้เข้าสู่ระบบ — เปิด Settings แล้วกด เข้าสู่ระบบ");
      return;
    }

    // The `ws` package (unlike a browser's WebSocket) lets a client set
    // arbitrary headers on the upgrade request — notify-server reads this
    // instead of a memberId/secret query pair, and derives who's connecting
    // from the verified token itself rather than trusting a client-claimed id.
    const ws = new WebSocket(this.url, { headers: { Authorization: `Bearer ${auth.accessToken}` } });
    this.ws = ws;
    let lastErrorDetail = null;

    ws.on("open", () => {
      this.backoffMs = 1000;
      lastErrorDetail = null;
      this.onStatus("connected");
    });

    ws.on("message", (data) => {
      try {
        this.onEvent(JSON.parse(data.toString()));
      } catch (err) {
        console.error("[ws-client] failed to parse event:", err.message);
      }
    });

    ws.on("close", (code) => {
      if (code === 4001) {
        // Token rejected even though we just fetched/refreshed it — e.g.
        // revoked server-side. Retrying on a timer won't help; needs a
        // fresh login.
        this.onStatus("unauthorized", "เข้าสู่ระบบไม่ผ่าน — ลองเข้าสู่ระบบใหม่จาก Settings");
        return;
      }
      // A real connection failure (refused, DNS, timeout) fires "error"
      // just before "close" — surface that reason here instead of the
      // generic "disconnected", or a genuine network problem looks
      // identical to "haven't tried connecting yet" in the UI.
      this.onStatus(lastErrorDetail ? "error" : "disconnected", lastErrorDetail);
      this._scheduleReconnect();
    });

    ws.on("error", (err) => {
      // "close" always follows "error" for ws, so the actual onStatus call
      // happens there — this only computes the reason to attach to it.
      //
      // Node's own dual-stack (IPv4+IPv6) connection attempts surface as an
      // AggregateError with an EMPTY top-level .message — the real reason
      // (e.g. "connect ECONNREFUSED 127.0.0.1:8092") is one level down, in
      // .errors[]. Fall back through the shapes actually seen in practice
      // rather than trust .message alone.
      lastErrorDetail = err.message || err.errors?.[0]?.message || err.code || String(err);
      console.error(`[ws-client] connection error: ${lastErrorDetail}`);
    });
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    setTimeout(() => this._connect(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
  }
}

module.exports = { ReconnectingClient };
