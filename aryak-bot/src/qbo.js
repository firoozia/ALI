// QUICKBOOKS ONLINE, READ ONLY IN THIS STAGE. OAuth 2.0 with the client id and secret from the settings. The owner connects from his own chat
// (connectLink -> Intuit -> the public page -> one line in his chat -> exchange), disconnects (revoke + delete) and reconnects; no playground. The
// rotating refresh token and the access token live in one file under authDir (mode 600) and every new refresh token is saved at once. A token, a
// secret, an authorization code or an Authorization header is never logged, never put in an error and never returned. The OAuth endpoints come from
// Intuit's discovery document (cached a day). Requests retry with backoff on 429 and 5xx (a 4xx validation error is never retried); a 401 refreshes
// once; an invalid_grant stops all calls until the owner reconnects. Every error response is written to a short error log with its intuit_tid and
// no token. Every write goes through write(), which refuses unless QBO_WRITE is on (it is off); this stage has no write function at all.

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const BASES = { sandbox: 'https://sandbox-quickbooks.api.intuit.com', production: 'https://quickbooks.api.intuit.com' };
const DISCOVERY = { sandbox: 'https://developer.intuit.com/.well-known/openid_sandbox_configuration', production: 'https://developer.intuit.com/.well-known/openid_configuration' };
// used only if the discovery document cannot be read
const FALLBACK = { authorization_endpoint: 'https://appcenter.intuit.com/connect/oauth2', token_endpoint: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', revocation_endpoint: 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke' };
const SCOPE = 'com.intuit.quickbooks.accounting';
const RETRIES = 4;
const DAY = 86400000;
const STATE_MS = 15 * 60 * 1000;
export const DEFAULT_REDIRECT = 'https://firoozia.github.io/atossa/connect.html';

export class QboError extends Error {
  constructor(message, status = 0, fault = null) { super(message); this.name = 'QboError'; this.status = status; this.reconnect = false; this.fault = fault; }
}

const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
/** A value inside a QuickBooks query string: single quotes and backslashes escaped. */
export const qboEscape = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** The one line the public page puts in the owner's chat: QBO-CONNECT <state> <realmId> <code>. Null when a text is not that line. */
export function parseConnectLine(text) {
  const m = /^QBO-CONNECT\s+([A-Za-z0-9_-]{16,128})\s+(\d{5,25})\s+([A-Za-z0-9._~+/=-]{8,1024})$/.exec(String(text || '').trim());
  return m ? { state: m[1], realmId: m[2], code: m[3] } : null;
}
export const looksLikeConnectLine = (text) => /^\s*QBO-CONNECT\b/.test(String(text || ''));

export class Qbo {
  constructor({ config, dir, fetchFn = globalThis.fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {}, onReconnect = null }) {
    this.config = config;
    this.dir = dir || '';
    this.file = dir ? path.join(dir, 'qbo-tokens.json') : '';
    this.fetchFn = fetchFn;
    this.now = now;
    this.sleep = sleep;
    this.log = log;
    this.onReconnect = onReconnect;
    this.t = { refresh: '', access: '', accessExpiresAt: 0, initHash: '', realmId: '', needsReconnect: false };
    this.lastCall = { at: 0, status: 0 };
    this.disc = null;
    this.controlFile = dir ? path.join(dir, 'qbo-control.json') : '';
    this.control = { paused: false };
    try { if (this.file) Object.assign(this.t, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first start */ }
    try { if (this.controlFile) Object.assign(this.control, JSON.parse(fs.readFileSync(this.controlFile, 'utf8'))); } catch { /* not paused */ }
  }

  /** The owner's kill switch (survives a restart): while paused, no call is made to QuickBooks at all. */
  get paused() { return !!this.control.paused; }
  setPaused(on) {
    this.control = { paused: !!on, at: new Date(this.now()).toISOString() };
    if (!this.controlFile) return;
    try { fs.mkdirSync(path.dirname(this.controlFile), { recursive: true }); fs.writeFileSync(this.controlFile, JSON.stringify(this.control), { mode: 0o600 }); } catch { /* best effort */ }
  }

  pausedError() { const e = new QboError('QuickBooks is paused by the owner'); e.paused = true; return e; }

  get env() { return this.config.qboEnv === 'production' ? 'production' : 'sandbox'; }
  get base() { return BASES[this.env]; }
  get writeOn() { return !!this.config.qboWrite; }
  get redirectUri() { return this.config.qboRedirectUri || DEFAULT_REDIRECT; }
  get realm() { return this.t.realmId || this.config.qboRealmId || ''; }

  /** The NAMES of the settings that are missing (never their values). */
  get missing() { return [['QBO_CLIENT_ID', this.config.qboClientId], ['QBO_CLIENT_SECRET', this.config.qboClientSecret]].filter(([, v]) => !v).map(([k]) => k); }
  /** The keys are set (the app exists); connected is a separate question. */
  get configured() { return this.missing.length === 0; }
  hasNewInit() { const init = this.config.qboRefreshInit || ''; return !!init && sha(init) !== this.t.initHash; }
  /** A token is on hand and a company is known. */
  get connected() { return !!(this.t.refresh || this.hasNewInit()) && !!this.realm; }
  get needsReconnect() { return !!this.t.needsReconnect && !this.hasNewInit(); }

  save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.t), { mode: 0o600 });
      fs.renameSync(tmp, this.file); // the rotating refresh token is on disk before anything else happens
    } catch (e) { this.log(`QuickBooks: the token file could not be saved (${e.code || 'error'})`); }
  }

  /** A short error log: one JSON line per error response with its intuit_tid, the last ~200 kept. Never a token, never a body. */
  errorLog(entry) {
    this.log(`QuickBooks error ${entry.status} ${entry.op} tid=${entry.tid || '-'}`);
    if (!this.dir) return;
    try {
      const f = path.join(this.dir, 'qbo-errors.log');
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(f, `${JSON.stringify({ at: new Date(this.now()).toISOString(), ...entry })}\n`, { mode: 0o600 });
      const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
      if (lines.length > 300) fs.writeFileSync(f, `${lines.slice(-200).join('\n')}\n`, { mode: 0o600 });
    } catch { /* best effort */ }
  }

  tidOf(res) { return String(res?.headers?.get?.('intuit_tid') || '').slice(0, 80); }

  /** The OAuth endpoints from Intuit's discovery document, cached a day (in memory and on disk). */
  async endpoints() {
    if (this.disc && this.now() - this.disc.at < DAY && this.disc.env === this.env) return this.disc.doc;
    const f = this.dir ? path.join(this.dir, 'qbo-discovery.json') : '';
    try { if (f) { const d = JSON.parse(fs.readFileSync(f, 'utf8')); if (d.env === this.env && this.now() - d.at < DAY && d.doc?.token_endpoint) { this.disc = d; return d.doc; } } } catch { /* none yet */ }
    try {
      const res = await this.fetchFn(DISCOVERY[this.env], { method: 'GET', headers: { Accept: 'application/json' } });
      const j = res.ok ? await res.json() : null;
      if (j?.token_endpoint && j?.authorization_endpoint) {
        this.disc = { env: this.env, at: this.now(), doc: { authorization_endpoint: j.authorization_endpoint, token_endpoint: j.token_endpoint, revocation_endpoint: j.revocation_endpoint || FALLBACK.revocation_endpoint } };
        if (f) { try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(f, JSON.stringify(this.disc)); } catch { /* best effort */ } }
        return this.disc.doc;
      }
      this.errorLog({ status: res.status, op: 'discovery', tid: this.tidOf(res) });
    } catch { this.log('QuickBooks: the discovery document could not be read; the built-in endpoints are used'); }
    return FALLBACK;
  }

  basic() { return `Basic ${Buffer.from(`${this.config.qboClientId}:${this.config.qboClientSecret}`).toString('base64')}`; }

  // ------------------------------------------------------------------------------------------------------------ connect, disconnect
  /** A one-time state (valid 15 minutes) and the Intuit authorize link for it. Only a hash of the state is kept. */
  async connectLink() {
    if (!this.config.qboClientId || !this.config.qboClientSecret) throw new QboError('QuickBooks is not set up (missing settings)');
    const state = randomBytes(24).toString('hex');
    this.t.connect = { hash: sha(state), at: this.now() };
    this.save();
    const ep = await this.endpoints();
    const q = { client_id: this.config.qboClientId, response_type: 'code', scope: SCOPE, redirect_uri: this.redirectUri, state };
    return { state, url: `${ep.authorization_endpoint}?${Object.entries(q).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` };
  }

  /** The state of the line is checked once (CSRF): right, not older than 15 minutes, never twice. */
  takeState(state) {
    const c = this.t.connect;
    delete this.t.connect; // one-time, whatever the outcome
    this.save();
    return !!c && c.hash === sha(state) && this.now() - c.at <= STATE_MS;
  }

  /** Exchanges the authorization code (useless without the secret) for the tokens, at once, and stores them with the company id. */
  async exchange({ code, realmId }) {
    if (!this.config.qboClientId || !this.config.qboClientSecret) throw new QboError('QuickBooks is not set up (missing settings)');
    const ep = await this.endpoints();
    const res = await this.fetchFn(ep.token_endpoint, {
      method: 'POST',
      headers: { Authorization: this.basic(), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.redirectUri }).toString(),
    });
    this.lastCall = { at: this.now(), status: res.status };
    let j = {};
    try { j = await res.json(); } catch { /* not json */ }
    if (!res.ok || !j.access_token || !j.refresh_token) {
      this.errorLog({ status: res.status, op: 'connect', tid: this.tidOf(res), error: String(j.error || '').slice(0, 40) });
      throw new QboError(`QuickBooks connect failed (${res.status}${j.error ? `: ${String(j.error).slice(0, 40)}` : ''})`, res.status);
    }
    this.t = {
      refresh: j.refresh_token, access: j.access_token, accessExpiresAt: this.now() + Math.max(60, Number(j.expires_in) || 3600) * 1000,
      initHash: this.config.qboRefreshInit ? sha(this.config.qboRefreshInit) : '', realmId: String(realmId), needsReconnect: false, connectedAt: new Date(this.now()).toISOString(),
    };
    this.save();
    this.log('QuickBooks: connected');
  }

  /** Revokes the refresh token at Intuit and deletes every stored token and the company id (the old init setting is never used again). */
  async disconnect() {
    const token = this.t.refresh;
    let revoked = false;
    if (token && this.config.qboClientId && this.config.qboClientSecret) {
      try {
        const ep = await this.endpoints();
        const res = await this.fetchFn(ep.revocation_endpoint, { method: 'POST', headers: { Authorization: this.basic(), Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        this.lastCall = { at: this.now(), status: res.status };
        revoked = res.ok;
        if (!res.ok) this.errorLog({ status: res.status, op: 'revoke', tid: this.tidOf(res) });
      } catch { this.log('QuickBooks: the revoke call failed; the stored tokens are deleted anyway'); }
    }
    this.t = { refresh: '', access: '', accessExpiresAt: 0, initHash: this.config.qboRefreshInit ? sha(this.config.qboRefreshInit) : '', realmId: '', needsReconnect: false };
    this.save();
    this.log('QuickBooks: disconnected');
    return { revoked };
  }

  // ------------------------------------------------------------------------------------------------------------ tokens
  /** The refresh token to use: a NEW value of the init setting (a fresh authorization), else the stored one. */
  refreshSource() {
    if (this.hasNewInit()) return { token: this.config.qboRefreshInit, fromInit: true };
    return { token: this.t.refresh || '', fromInit: false };
  }

  reconnectError() { const e = new QboError('QuickBooks needs reconnecting'); e.reconnect = true; return e; }

  /** Gets a new access token (and the new rotating refresh token, saved at once). */
  async refresh() {
    if (this.needsReconnect) throw this.reconnectError();
    const { token, fromInit } = this.refreshSource();
    if (!this.config.qboClientId || !this.config.qboClientSecret || !token) throw new QboError('QuickBooks is not connected');
    const ep = await this.endpoints();
    const res = await this.fetchFn(ep.token_endpoint, {
      method: 'POST',
      headers: { Authorization: this.basic(), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token }).toString(),
    });
    this.lastCall = { at: this.now(), status: res.status };
    let j = {};
    try { j = await res.json(); } catch { /* not json */ }
    if (!res.ok || !j.access_token) {
      this.errorLog({ status: res.status, op: 'refresh', tid: this.tidOf(res), error: String(j.error || '').slice(0, 40) });
      // an expired, revoked or invalid refresh token: stop all calls until the owner reconnects, and tell him once
      if (j.error === 'invalid_grant' || (res.status === 400 && !j.error) || res.status === 401) {
        const first = !this.t.needsReconnect;
        this.t.needsReconnect = true;
        if (fromInit) this.t.initHash = sha(this.config.qboRefreshInit); // that init value is spent
        this.save();
        if (first && this.onReconnect) { try { this.onReconnect(); } catch { /* a notice must never break the call */ } }
        throw this.reconnectError();
      }
      throw new QboError(`QuickBooks login failed (${res.status}${j.error ? `: ${String(j.error).slice(0, 40)}` : ''})`, res.status);
    }
    this.t = {
      ...this.t,
      refresh: j.refresh_token || token,
      access: j.access_token,
      accessExpiresAt: this.now() + Math.max(60, Number(j.expires_in) || 3600) * 1000,
      initHash: fromInit ? sha(this.config.qboRefreshInit) : this.t.initHash,
      needsReconnect: false,
      refreshedAt: new Date(this.now()).toISOString(),
    };
    this.save();
    this.log('QuickBooks: access token refreshed');
    return this.t.access;
  }

  async accessToken() {
    if (this.paused) throw this.pausedError();
    if (this.needsReconnect) throw this.reconnectError();
    if (this.t.access && this.t.accessExpiresAt - this.now() > 60 * 1000) return this.t.access;
    return this.refreshOnce();
  }

  /** One refresh at a time: the refresh token rotates, so two at once would spoil each other. */
  refreshOnce() {
    if (!this.inflight) this.inflight = this.refresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** Refreshes BEFORE the access token expires (called every few minutes), so the refresh token also stays alive. Never throws. */
  async keepFresh({ marginMs = 10 * 60 * 1000 } = {}) {
    try {
      if (this.paused || !this.connected || this.needsReconnect) return false;
      if (this.t.access && this.t.accessExpiresAt - this.now() > marginMs) return false;
      await this.refreshOnce();
      return true;
    } catch { return false; }
  }

  // ------------------------------------------------------------------------------------------------------------ requests
  /** One GET with the retries. [pathPart]: after /v3/company/<realm>/. Returns the parsed JSON. */
  async get(pathPart, query = {}) {
    return this.send('GET', pathPart, query, undefined);
  }

  /** A GET that returns bytes (an invoice PDF). */
  async getBinary(pathPart, query = {}) {
    return this.send('GET', pathPart, query, undefined, { accept: 'application/pdf', binary: true });
  }

  async send(method, pathPart, query, body, { accept = 'application/json', binary = false } = {}) {
    if (this.paused) throw this.pausedError();
    if (!this.realm) throw new QboError('QuickBooks is not connected (no company id)');
    // spaces as %20 (Intuit's own examples), not the "+" of form encoding
    const qs = Object.entries({ ...query, minorversion: String(this.config.qboMinorVersion || 75) }).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const url = `${this.base}/v3/company/${encodeURIComponent(this.realm)}/${pathPart}?${qs}`;
    const label = String(pathPart).split(/[/?]/)[0];
    let refreshedOn401 = false;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const token = await this.accessToken();
      const res = await this.fetchFn(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: accept, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      this.lastCall = { at: this.now(), status: res.status };
      this.log(`QuickBooks ${method} ${label} -> ${res.status}`);
      if (res.status === 401 && !refreshedOn401) { refreshedOn401 = true; this.t.access = ''; this.t.accessExpiresAt = 0; continue; }
      let j = {};
      if (!res.ok) { try { j = await res.json(); } catch { /* not json */ } }
      const fe = j?.Fault?.Error?.[0] || j?.fault?.error?.[0] || {};
      const fault = { code: String(fe.code ?? '').slice(0, 20), message: String(fe.Message ?? fe.message ?? '').slice(0, 200), detail: String(fe.Detail ?? fe.detail ?? '').slice(0, 300), element: String(fe.element ?? '').slice(0, 80) };
      // the Fault (code, message, detail, element) is what explains a 400; it carries no token and no body of ours
      if (!res.ok) this.errorLog({ status: res.status, op: `${method} ${label}`, tid: this.tidOf(res), ...(fault.code || fault.message || fault.detail || fault.element ? { fault } : {}) });
      if ((res.status === 429 || res.status >= 500) && attempt < RETRIES - 1) {
        const ra = Number(res.headers?.get?.('retry-after'));
        await this.sleep(Math.min(30000, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt));
        continue;
      }
      if (binary && res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.ok) { try { j = await res.json(); } catch { /* not json */ } }
      if (!res.ok) {
        const detail = [fault.message, fault.detail].filter(Boolean).join(' - ');
        throw new QboError(`QuickBooks request failed (${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}${fault.element ? ` [${fault.element}]` : ''})`, res.status, fault);
      }
      return j;
    }
    throw new QboError('QuickBooks request failed (retries used up)', 0);
  }

  /** All the rows of a query ("select * from Invoice where CustomerRef = '58'"), page by page. */
  async query(sql, { pageSize = 1000, maxPages = 20 } = {}) {
    const entity = /\bfrom\s+(\w+)/i.exec(sql)?.[1];
    if (!entity) throw new QboError('QuickBooks query without a table');
    const out = [];
    for (let page = 0; page < maxPages; page++) {
      const j = await this.get('query', { query: `${sql} STARTPOSITION ${1 + page * pageSize} MAXRESULTS ${pageSize}` });
      const rows = j?.QueryResponse?.[entity] || [];
      out.push(...rows);
      if (rows.length < pageSize) break;
    }
    return out;
  }

  async companyInfo() {
    const j = await this.get(`companyinfo/${encodeURIComponent(this.realm)}`);
    return j?.CompanyInfo || null;
  }

  /**
   * Every write goes through here. It refuses unless QBO_WRITE is on, and it knows TWO writes only: create an invoice (POST invoice) and the sparse
   * update of a customer's name. Anything else (a delete, a void, a payment, a refund, any other update) is refused here whatever the caller asks.
   * [requestId] makes the invoice create idempotent.
   */
  async write(method, pathPart, body, { requestId = '' } = {}) {
    if (!this.writeOn) throw new QboError('QuickBooks writes are switched off (QBO_WRITE)');
    // the other writes are SPARSE updates only (Id + SyncToken + sparse + ONE job's fields); no create, no delete, no inactivate:
    //   customer: the name (DisplayName, CompanyName), or the e-mail (PrimaryEmailAddr), or the mobile (Mobile); never a mix of the jobs
    //   item: the sales tax code (SalesTaxCodeRef), or the base price (UnitPrice); never a mix
    const SPARSE = {
      customer: [['DisplayName', 'CompanyName'], ['PrimaryEmailAddr'], ['Mobile']],
      item: [['SalesTaxCodeRef'], ['UnitPrice']],
    };
    if (method === 'POST' && SPARSE[pathPart]) {
      const keys = Object.keys(body || {});
      const data = keys.filter((k) => !['Id', 'SyncToken', 'sparse'].includes(k));
      const okJob = SPARSE[pathPart].some((job) => data.length > 0 && data.every((k) => job.includes(k)));
      if (body?.sparse !== true || !body.Id || body.SyncToken === undefined || !okJob) throw new QboError(`QuickBooks: only a sparse update of one allowed field set of a ${pathPart} is allowed`);
      return this.send('POST', pathPart, {}, body);
    }
    if (method !== 'POST' || pathPart !== 'invoice') throw new QboError('QuickBooks: only creating an invoice is allowed');
    return this.send('POST', 'invoice', requestId ? { requestid: requestId } : {}, body);
  }
}
