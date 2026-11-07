// QUICKBOOKS ONLINE, READ ONLY IN THIS STAGE. OAuth 2.0 with the client id and secret from the settings; the first refresh token comes from the
// settings once (QBO_REFRESH_TOKEN_INIT), after that the rotating refresh token and the access token live in one file under authDir (mode 600) and
// every new refresh token is saved at once. A token, a secret or an Authorization header is never logged, never put in an error and never
// returned. Requests retry with backoff on 429 and 5xx; a 401 refreshes once. Every write goes through write(), which refuses unless QBO_WRITE is on
// (it is off); this stage has no write function at all.

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const BASES = { sandbox: 'https://sandbox-quickbooks.api.intuit.com', production: 'https://quickbooks.api.intuit.com' };
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const RETRIES = 4;

export class QboError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'QboError'; this.status = status; }
}

const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
/** A value inside a QuickBooks query string: single quotes and backslashes escaped. */
export const qboEscape = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class Qbo {
  constructor({ config, dir, fetchFn = globalThis.fetch, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} }) {
    this.config = config;
    this.dir = dir || '';
    this.file = dir ? path.join(dir, 'qbo-tokens.json') : '';
    this.fetchFn = fetchFn;
    this.now = now;
    this.sleep = sleep;
    this.log = log;
    this.t = { refresh: '', access: '', accessExpiresAt: 0, initHash: '' };
    this.lastCall = { at: 0, status: 0 };
    try { if (this.file) Object.assign(this.t, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch { /* first start */ }
  }

  get env() { return this.config.qboEnv === 'production' ? 'production' : 'sandbox'; }
  get base() { return BASES[this.env]; }
  get writeOn() { return !!this.config.qboWrite; }

  /** The NAMES of the settings that are missing (never their values). */
  get missing() {
    const c = this.config;
    return [['QBO_CLIENT_ID', c.qboClientId], ['QBO_CLIENT_SECRET', c.qboClientSecret], ['QBO_REALM_ID', c.qboRealmId], ['QBO_REFRESH_TOKEN_INIT', this.t.refresh || c.qboRefreshInit]].filter(([, v]) => !v).map(([k]) => k);
  }

  get configured() { return this.missing.length === 0; }

  save() {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.t), { mode: 0o600 });
      fs.renameSync(tmp, this.file); // the rotating refresh token is on disk before anything else happens
    } catch (e) { this.log(`QuickBooks: the token file could not be saved (${e.code || 'error'})`); }
  }

  /** The refresh token to use: the stored one, or the one from the settings (once; a NEW value in the settings replaces the stored one). */
  refreshSource() {
    const init = this.config.qboRefreshInit || '';
    if (init && sha(init) !== this.t.initHash) return { token: init, fromInit: true };
    return { token: this.t.refresh || '', fromInit: false };
  }

  /** Gets a new access token (and the new rotating refresh token, saved at once). */
  async refresh() {
    const { token, fromInit } = this.refreshSource();
    if (!this.config.qboClientId || !this.config.qboClientSecret || !token) throw new QboError('QuickBooks is not set up (missing settings)');
    const basic = Buffer.from(`${this.config.qboClientId}:${this.config.qboClientSecret}`).toString('base64');
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token }).toString(),
    });
    this.lastCall = { at: this.now(), status: res.status };
    let j = {};
    try { j = await res.json(); } catch { /* not json */ }
    if (!res.ok || !j.access_token) {
      this.log(`QuickBooks: the token refresh failed (${res.status}${j.error ? `, ${String(j.error).slice(0, 40)}` : ''})`);
      throw new QboError(`QuickBooks login failed (${res.status}${j.error ? `: ${String(j.error).slice(0, 40)}` : ''})`, res.status);
    }
    this.t = {
      refresh: j.refresh_token || token,
      access: j.access_token,
      accessExpiresAt: this.now() + Math.max(60, Number(j.expires_in) || 3600) * 1000,
      initHash: fromInit ? sha(this.config.qboRefreshInit) : this.t.initHash,
      refreshedAt: new Date(this.now()).toISOString(),
    };
    this.save();
    this.log('QuickBooks: access token refreshed');
    return this.t.access;
  }

  async accessToken() {
    if (this.t.access && this.t.accessExpiresAt - this.now() > 60 * 1000) return this.t.access;
    // one refresh at a time: the refresh token rotates, so two at once would spoil each other
    if (!this.inflight) this.inflight = this.refresh().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** One GET with the retries. [pathPart]: after /v3/company/<realm>/. Returns the parsed JSON. */
  async get(pathPart, query = {}) {
    return this.send('GET', pathPart, query, undefined);
  }

  async send(method, pathPart, query, body) {
    if (!this.config.qboRealmId) throw new QboError('QuickBooks is not set up (no company id)');
    // spaces as %20 (Intuit's own examples), not the "+" of form encoding
    const qs = Object.entries({ ...query, minorversion: String(this.config.qboMinorVersion || 75) }).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const url = `${this.base}/v3/company/${encodeURIComponent(this.config.qboRealmId)}/${pathPart}?${qs}`;
    const label = String(pathPart).split(/[/?]/)[0];
    let refreshedOn401 = false;
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const token = await this.accessToken();
      const res = await this.fetchFn(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      this.lastCall = { at: this.now(), status: res.status };
      this.log(`QuickBooks ${method} ${label} -> ${res.status}`);
      if (res.status === 401 && !refreshedOn401) { refreshedOn401 = true; this.t.access = ''; this.t.accessExpiresAt = 0; continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < RETRIES - 1) {
        const ra = Number(res.headers?.get?.('retry-after'));
        await this.sleep(Math.min(30000, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt));
        continue;
      }
      let j = {};
      try { j = await res.json(); } catch { /* not json */ }
      if (!res.ok) {
        const detail = j?.Fault?.Error?.[0]?.Message || j?.fault?.error?.[0]?.message || '';
        throw new QboError(`QuickBooks request failed (${res.status}${detail ? `: ${String(detail).slice(0, 120)}` : ''})`, res.status);
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
    const j = await this.get(`companyinfo/${encodeURIComponent(this.config.qboRealmId)}`);
    return j?.CompanyInfo || null;
  }

  /** Every write goes through here and refuses unless QBO_WRITE is on. This stage defines no caller. */
  async write(method, pathPart, body) {
    if (!this.writeOn) throw new QboError('QuickBooks writes are switched off (QBO_WRITE)');
    return this.send(method, pathPart, {}, body);
  }
}
