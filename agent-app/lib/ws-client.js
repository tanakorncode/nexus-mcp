const WebSocket = require("ws");

// Maintains one outbound connection to notify-server, reconnecting with
// backoff on any drop (network blip, laptop sleep/wake, server restart).
// Never gives up — this is meant to run for the lifetime of the app.
class ReconnectingClient {
  constructor({ url, memberId, secret, onEvent, onStatus }) {
    this.url = url;
    this.memberId = memberId;
    this.secret = secret;
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

  _connect() {
    if (this.stopped) return;

    const url = `${this.url}?memberId=${encodeURIComponent(this.memberId)}&secret=${encodeURIComponent(this.secret)}`;
    this.onStatus("connecting");
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => {
      this.backoffMs = 1000;
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
      this.onStatus("disconnected");
      if (code === 4001) {
        // Bad secret/memberId — retrying won't help until settings change.
        this.onStatus("unauthorized");
        return;
      }
      this._scheduleReconnect();
    });

    ws.on("error", (err) => {
      // "close" always follows "error" for ws, so reconnect is scheduled
      // there — this only logs the actual reason (connection refused, DNS
      // failure, timeout, etc.), which "close" alone never carries.
      //
      // Node's own dual-stack (IPv4+IPv6) connection attempts surface as an
      // AggregateError with an EMPTY top-level .message — the real reason
      // (e.g. "connect ECONNREFUSED 127.0.0.1:8092") is one level down, in
      // .errors[]. Fall back through the shapes actually seen in practice
      // rather than trust .message alone.
      const detail = err.message || err.errors?.[0]?.message || err.code || String(err);
      console.error(`[ws-client] connection error: ${detail}`);
    });
  }

  _scheduleReconnect() {
    if (this.stopped) return;
    setTimeout(() => this._connect(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
  }
}

module.exports = { ReconnectingClient };
