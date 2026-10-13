/**
 * Zinax Stock: Google Sheets backend.
 *
 * Install (once):
 * 1. Create a Google Sheet named "Zinax Stock Data".
 * 2. Extensions > Apps Script, paste this file, save.
 * 3. Run `setup` and allow access. The log prints the token and the admin code for the app.
 *    (Run it again any time to see them; it changes nothing else.)
 * 4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *    Copy the URL ending in /exec into the app's Settings with the token.
 *
 * `setup` also installs the weekly backup (see BACKUP_* below).
 */

const BACKUP_DAY = ScriptApp.WeekDay.FRIDAY;
const BACKUP_HOUR = 2;
const BACKUP_KEEP = 12;
const BACKUP_FOLDER = 'Zinax Stock Backups';

// Column order of each sheet. The first column is the row ID; ServerAt is set by this script.
const SHEETS = {
  Items: ['ID', 'Category', 'Code', 'Size', 'Qty', 'Remaining', 'Unit', 'Status', 'Shipment', 'Pallet', 'NetKg', 'GrossKg',
          'ReceivedAt', 'Location', 'Device', 'UpdatedAt', 'ServerAt', 'ShipmentId'],
  Movements: ['ID', 'ItemID', 'Type', 'Qty', 'Unit', 'Code', 'Size', 'Reference', 'At', 'Device', 'ServerAt', 'User',
              'Customer', 'Invoice'],
  Shipments: ['ID', 'Name', 'Source', 'CreatedAt', 'UpdatedAt', 'ServerAt'],
  Expected: ['ID', 'ShipmentID', 'Pallet', 'Line', 'Category', 'Code', 'Size', 'Qty', 'Unit', 'NetKg', 'GrossKg', 'ItemID',
             'UpdatedAt', 'ServerAt'],
  // Customer library shared by the phones. Add a name on a new row, fix a name, or put TRUE in Hidden to stop suggesting it.
  Customers: ['ID', 'Name', 'CreatedAt', 'By', 'Hidden', 'UpdatedAt', 'ServerAt'],
  // People who sign in to the app. Role ADMIN or USER; Active FALSE stops someone signing in. PINs are stored hashed.
  Users: ['ID', 'Name', 'Role', 'CanReceive', 'Active', 'PinHash', 'Salt', 'UpdatedAt', 'ServerAt'],
  // Product groups. ID is stored on labels; Name, Unit and Pack can be changed here. Add a group by typing a Name on a new row.
  Groups: ['ID', 'Name', 'Unit', 'Pack', 'Order', 'Hidden', 'UpdatedAt', 'ServerAt'],
  // Product catalog. Group is a group ID from the Groups tab. Add a product by typing a Group and Code on a new row.
  Products: ['ID', 'Group', 'Code', 'Size', 'Unit', 'PackQty', 'Note', 'Hidden', 'UpdatedAt', 'ServerAt'],
  // Undo and delete asked by users, and the admin's answer.
  Requests: ['ID', 'Kind', 'Target', 'Summary', 'Reason', 'RequestedBy', 'Device', 'RequestedAt', 'Status', 'DecidedBy',
             'DecidedAt', 'Note', 'UpdatedAt', 'ServerAt', 'Payload'],
};

// Columns kept as plain text so codes like "0101" or sizes like "0.30*1400" are not turned into numbers.
const TEXT_COLUMNS = {
  Items: ['Code', 'Size', 'Pallet'],
  Movements: ['Code', 'Size', 'Invoice'],
  Expected: ['Pallet', 'Code', 'Size'],
  Shipments: [],
  Customers: ['Name'],
  Users: ['Name', 'PinHash', 'Salt'],
  Requests: ['Target'],
  Groups: ['Name'],
  Products: ['Code', 'Size', 'Note'],
};

function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SHEETS).forEach(function (name) { sheet_(name); });
  stockSheet_();
  outSheet_();
  cutsSheet_();
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('ZINAX_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    props.setProperty('ZINAX_TOKEN', token);
  }
  const adminCode = adminCode_();
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'weeklyBackup'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(BACKUP_DAY).atHour(BACKUP_HOUR).create();
  Logger.log('Token for the app: ' + token);
  Logger.log('Admin code (to create the first admin or reset a PIN): ' + adminCode);
  Logger.log('Sheet: ' + ss.getUrl());
}

function doGet() {
  return json_({ ok: true, app: 'Zinax Stock', hint: 'POST from the app to sync.' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('ZINAX_TOKEN');
  if (!token || req.token !== token) return json_({ ok: false, error: 'Wrong token. Copy it again from the Apps Script log.' });
  // Asked every few seconds by open apps: answers without touching the sheet.
  if (req.action === 'poll') return json_({ ok: true, rev: props.getProperty('ZINAX_REV') || '0' });
  if (req.action === 'verifyAdmin') {
    const code = props.getProperty('ZINAX_ADMIN_CODE');
    if (!code) return json_({ ok: false, error: 'No admin code yet. In Apps Script run setup once, then read the code in the log.' });
    return json_(String(req.code || '').trim().toUpperCase() === code ? { ok: true } : { ok: false, error: 'Wrong admin code' });
  }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    if (req.action === 'ping') return json_({ ok: true, now: Date.now() });
    if (req.action === 'sync') return json_(sync_(req));
    return json_({ ok: false, error: 'Unknown action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

function sync_(req) {
  const now = Date.now();
  const since = Number(req.since) || 0;
  const shipmentNames = {};

  upsert_('Shipments', req.shipments || [], function (s) {
    return [s.id, s.name, s.source, date_(s.createdAt), s.updatedAt, now];
  }, 4);
  readAll_('Shipments').forEach(function (r) { shipmentNames[r[0]] = r[1]; });

  upsert_('Expected', req.expected || [], function (u) {
    return [u.id, u.shipmentId, u.pallet, u.lineNo, u.category, u.code, u.size, u.qty, u.unit,
            blank_(u.netKg), blank_(u.grossKg), u.itemId || '', u.updatedAt, now];
  }, 12);

  upsert_('Items', req.items || [], function (i) {
    return [i.id, i.category, i.code, i.size, i.qty, i.remaining, i.unit, i.status, shipmentNames[i.shipmentId] || '',
            i.pallet || '', blank_(i.netKg), blank_(i.grossKg), date_(i.receivedAt), i.location || '', i.device,
            i.updatedAt, now, i.shipmentId || ''];
  }, 15);

  appendNew_('Movements', req.movements || [], function (m) {
    return [m.id, m.itemId, m.type, m.qty, m.unit, m.code, m.size, m.reference || '', date_(m.at), m.device, now, m.user || '',
            m.customer || '', m.invoice || ''];
  });

  upsert_('Customers', req.customers || [], function (c) {
    return [c.id, c.name, date_(c.createdAt), c.createdBy || '', c.hidden ? true : false, c.updatedAt, now];
  }, 5);

  upsert_('Users', req.users || [], function (u) {
    return [u.id, u.name, u.role === 'ADMIN' ? 'ADMIN' : 'USER', u.canReceive ? true : false, u.active === false ? false : true,
            u.pinHash || '', u.salt || '', u.updatedAt, now];
  }, 7);

  // A decision is final: once approved or rejected, a later write from another phone does not change it.
  upsert_('Requests', req.requests || [], function (r) {
    return [r.id, r.kind, r.target, r.summary || '', r.reason || '', r.requestedBy || '', r.device || '', date_(r.requestedAt),
            r.status || 'PENDING', r.decidedBy || '', date_(r.decidedAt), r.note || '', r.updatedAt, now, r.payload || ''];
  }, 12, function (old) { return old[8] && old[8] !== 'PENDING'; });

  upsert_('Groups', req.groups || [], function (g) {
    return [g.id, g.name, g.unit, g.pack, Number(g.order) || 0, g.hidden ? true : false, g.updatedAt, now];
  }, 6);
  upsert_('Products', req.products || [], function (p) {
    return [p.id, p.groupId, p.code, p.size || '', p.unit, Number(p.packQty) || '', p.note || '', p.hidden ? true : false, p.updatedAt, now];
  }, 8);

  const pushed = ['shipments', 'expected', 'items', 'movements', 'customers', 'users', 'requests', 'groups', 'products']
    .some(function (k) { return (req[k] || []).length; });
  if (pushed) bump_();

  if ((req.items || []).length) stockSheet_();
  if ((req.movements || []).length) { outSheet_(); cutsSheet_(); }
  const movementsSince = req.movementsSince === undefined ? since : Number(req.movementsSince) || 0;

  return {
    ok: true,
    now: now,
    sheetUrl: SpreadsheetApp.getActive().getUrl(),
    shipments: changed_('Shipments', since).map(function (r) {
      return { id: r[0], name: r[1], source: r[2], createdAt: ms_(r[3]), updatedAt: Number(r[4]) };
    }),
    expected: changed_('Expected', since).map(function (r) {
      return { id: r[0], shipmentId: r[1], pallet: String(r[2]), lineNo: Number(r[3]), category: r[4], code: String(r[5]),
               size: String(r[6]), qty: Number(r[7]), unit: r[8], netKg: num_(r[9]), grossKg: num_(r[10]),
               itemId: r[11], updatedAt: Number(r[12]) };
    }),
    items: changed_('Items', since).map(function (r) {
      return { id: r[0], category: r[1], code: String(r[2]), size: String(r[3]), qty: Number(r[4]), remaining: Number(r[5]),
               unit: r[6], status: r[7], pallet: String(r[9]), netKg: num_(r[10]), grossKg: num_(r[11]),
               receivedAt: ms_(r[12]), location: String(r[13]), device: r[14], updatedAt: Number(r[15]), shipmentId: r[17] };
    }),
    movements: changed_('Movements', movementsSince).map(function (r) {
      return { id: r[0], itemId: r[1], type: r[2], qty: Number(r[3]), unit: r[4], code: String(r[5]), size: String(r[6]),
               reference: String(r[7]), at: ms_(r[8]), device: String(r[9]), user: String(r[11] || ''),
               customer: String(r[12] || ''), invoice: String(r[13] || '') };
    }),
    rev: PropertiesService.getScriptProperties().getProperty('ZINAX_REV') || '0',
    groups: changed_('Groups', since).filter(function (r) { return String(r[0]).trim(); }).map(function (r) {
      return { id: String(r[0]), name: String(r[1]), unit: String(r[2]), pack: String(r[3]), order: Number(r[4]) || 0,
               hidden: yes_(r[5]), updatedAt: Number(r[6]) || 0 };
    }),
    products: changed_('Products', since).filter(function (r) { return String(r[0]).trim() && String(r[2]).trim(); }).map(function (r) {
      return { id: String(r[0]), groupId: String(r[1]), code: String(r[2]), size: String(r[3]), unit: String(r[4]),
               packQty: Number(r[5]) || 0, note: String(r[6] || ''), hidden: yes_(r[7]), updatedAt: Number(r[8]) || 0 };
    }),
    users: changed_('Users', since).filter(function (r) { return String(r[1]).trim(); }).map(function (r) {
      return { id: String(r[0]), name: String(r[1]).trim(), role: String(r[2]).trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER',
               canReceive: yes_(r[3]), active: r[4] === '' ? true : yes_(r[4]), pinHash: String(r[5] || ''),
               salt: String(r[6] || ''), updatedAt: Number(r[7]) || 0 };
    }),
    requests: changed_('Requests', since).map(function (r) {
      return { id: String(r[0]), kind: String(r[1]), target: String(r[2]), summary: String(r[3]), reason: String(r[4]),
               requestedBy: String(r[5]), device: String(r[6]), requestedAt: ms_(r[7]), status: String(r[8] || 'PENDING'),
               decidedBy: String(r[9] || ''), decidedAt: ms_(r[10]), note: String(r[11] || ''), updatedAt: Number(r[12]) || 0,
               payload: String(r[14] || '') };
    }),
    customers: changed_('Customers', since).filter(function (r) { return String(r[1]).trim(); }).map(function (r) {
      return { id: String(r[0]), name: String(r[1]).trim(), createdAt: ms_(r[2]), createdBy: String(r[3] || ''),
               hidden: yes_(r[4]), updatedAt: Number(r[5]) || 0 };
    }),
  };
}

// ---------- hand edits in the sheet ----------

/**
 * Runs when someone edits the sheet by hand. Edits in the Items tab are stamped so the phones
 * pick them up on their next sync. Remaining 0 marks a package shipped; above 0 puts it back in stock.
 * A change to Remaining is logged in Movements as ADJUST.
 */
function onEdit(e) {
  const sh = e.range.getSheet();
  if (sh.getName() === 'Customers') return customersEdited_(e);
  if (sh.getName() === 'Users') return usersEdited_(e);
  if (sh.getName() === 'Groups') return catalogEdited_(e, 'Groups');
  if (sh.getName() === 'Products') return catalogEdited_(e, 'Products');
  if (sh.getName() !== 'Items') return;
  const first = Math.max(2, e.range.getRow());
  const last = e.range.getLastRow();
  if (last < first) return;
  const cols = SHEETS.Items;
  const C = function (name) { return cols.indexOf(name); };
  const rows = sh.getRange(first, 1, last - first + 1, cols.length).getValues();
  const now = Date.now();
  rows.forEach(function (r) {
    if (!r[0]) return;
    if (r[C('Remaining')] !== '' && !isNaN(Number(r[C('Remaining')]))) {
      const left = Number(r[C('Remaining')]);
      if (left <= 0 && r[C('Status')] === 'IN_STOCK') r[C('Status')] = 'SHIPPED';
      else if (left > 0 && r[C('Status')] === 'SHIPPED') r[C('Status')] = 'IN_STOCK';
    }
    // Never older than what a phone last wrote, even if its clock runs ahead.
    r[C('UpdatedAt')] = Math.max(now, (Number(r[C('UpdatedAt')]) || 0) + 1);
    r[C('ServerAt')] = now;
  });
  sh.getRange(first, 1, rows.length, cols.length).setValues(rows);
  bump_();

  const remainingCol = C('Remaining') + 1;
  if (rows.length === 1 && e.range.getNumColumns() === 1 && e.range.getColumn() === remainingCol && rows[0][0]) {
    const r = rows[0];
    const delta = (Number(e.value) || 0) - (Number(e.oldValue) || 0);
    if (delta !== 0) {
      const mv = sheet_('Movements');
      mv.getRange(mv.getLastRow() + 1, 1, 1, SHEETS.Movements.length).setValues([[
        Utilities.getUuid(), r[0], 'ADJUST', delta, r[C('Unit')], r[C('Code')], r[C('Size')],
        'Edited in sheet', new Date(now), 'SHEET', now, '', '', '',
      ]]);
    }
  }
  stockSheet_();
}

/**
 * Edits in the Customers tab: a name typed on a new row gets an ID; every edited row is stamped
 * so the phones take the change on their next sync.
 */
function customersEdited_(e) {
  const sh = e.range.getSheet();
  const first = Math.max(2, e.range.getRow());
  const last = e.range.getLastRow();
  if (last < first) return;
  const width = SHEETS.Customers.length;
  const rows = sh.getRange(first, 1, last - first + 1, width).getValues();
  const now = Date.now();
  rows.forEach(function (r) {
    if (!String(r[1]).trim()) return;
    if (!r[0]) {
      r[0] = Utilities.getUuid();
      r[2] = new Date(now);
      r[3] = r[3] || 'SHEET';
    }
    r[4] = yes_(r[4]);
    r[5] = Math.max(now, (Number(r[5]) || 0) + 1);
    r[6] = now;
  });
  sh.getRange(first, 1, rows.length, width).setValues(rows);
  bump_();
}

/**
 * Fallback: run this by hand from the Apps Script editor (Run > stampCustomers) if names were pasted into the
 * Customers tab but their ID and date did not fill in by themselves. It stamps every row that has a name.
 */
function stampCustomers() {
  const sh = sheet_('Customers');
  const last = sh.getLastRow();
  if (last < 2) return;
  customersEdited_({ range: { getSheet: function () { return sh; }, getRow: function () { return 2; }, getLastRow: function () { return last; } } });
}

/**
 * Edits in the Users tab: Role, CanReceive and Active can be changed by hand. New users and PINs
 * are made in the app, because the sheet only holds the PIN's hash.
 */
function usersEdited_(e) {
  const sh = e.range.getSheet();
  const first = Math.max(2, e.range.getRow());
  const last = e.range.getLastRow();
  if (last < first) return;
  const width = SHEETS.Users.length;
  const rows = sh.getRange(first, 1, last - first + 1, width).getValues();
  const now = Date.now();
  rows.forEach(function (r) {
    if (!r[0]) return;
    r[2] = String(r[2]).trim().toUpperCase() === 'ADMIN' ? 'ADMIN' : 'USER';
    r[3] = yes_(r[3]);
    r[4] = r[4] === '' ? true : yes_(r[4]);
    r[7] = Math.max(now, (Number(r[7]) || 0) + 1);
    r[8] = now;
  });
  sh.getRange(first, 1, rows.length, width).setValues(rows);
  bump_();
}

/**
 * Edits in the Groups and Products tabs: a new row gets an ID, Hidden becomes TRUE/FALSE, and every
 * edited row is stamped so the phones take the change on their next sync.
 */
function catalogEdited_(e, name) {
  const sh = e.range.getSheet();
  const first = Math.max(2, e.range.getRow());
  const last = e.range.getLastRow();
  if (last < first) return;
  const cols = SHEETS[name];
  const C = function (n) { return cols.indexOf(n); };
  const rows = sh.getRange(first, 1, last - first + 1, cols.length).getValues();
  const now = Date.now();
  rows.forEach(function (r) {
    if (name === 'Groups') {
      if (!String(r[C('Name')]).trim()) return;
      if (!r[0]) r[0] = 'G_' + String(r[C('Name')]).trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
      if (!String(r[C('Unit')]).trim()) r[C('Unit')] = 'pcs';
      if (!String(r[C('Pack')]).trim()) r[C('Pack')] = 'pack';
    } else {
      if (!String(r[C('Code')]).trim()) return;
      if (!r[0]) r[0] = 'P_' + Utilities.getUuid().replace(/-/g, '').slice(0, 20);
      if (!String(r[C('Group')]).trim()) r[C('Group')] = 'OTHER';
    }
    r[C('Hidden')] = yes_(r[C('Hidden')]);
    r[C('UpdatedAt')] = Math.max(now, (Number(r[C('UpdatedAt')]) || 0) + 1);
    r[C('ServerAt')] = now;
  });
  sh.getRange(first, 1, rows.length, cols.length).setValues(rows);
  bump_();
  if (name === 'Groups') stockSheet_();
}

/** Tells open apps (through `poll`) that something changed and they should sync. */
function bump_() {
  PropertiesService.getScriptProperties().setProperty('ZINAX_REV', String(Date.now()));
}

/** The code that lets someone create the first admin, or reset a PIN, from the app. Made once. */
function adminCode_() {
  const props = PropertiesService.getScriptProperties();
  let code = props.getProperty('ZINAX_ADMIN_CODE');
  if (!code) {
    code = Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
    props.setProperty('ZINAX_ADMIN_CODE', code);
  }
  return code;
}

// ---------- sheet helpers ----------

function sheet_(name) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  const headers = SHEETS[name];
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0 || sh.getRange(1, 1).getValue() !== headers[0]) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    TEXT_COLUMNS[name].forEach(function (col) {
      const c = headers.indexOf(col) + 1;
      sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  } else if (sh.getLastColumn() < headers.length) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  }
  return sh;
}

function readAll_(name) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, SHEETS[name].length).getValues();
}

/**
 * Insert or replace rows by ID. A row is replaced only when the incoming UpdatedAt is not older,
 * and never when [keep] says the existing row must stay.
 */
function upsert_(name, objects, toRow, updatedIdx, keep) {
  if (!objects.length) return;
  const sh = sheet_(name);
  const width = SHEETS[name].length;
  const data = readAll_(name);
  const index = {};
  data.forEach(function (r, i) { index[String(r[0])] = i; });
  let changed = false;
  objects.forEach(function (o) {
    const row = toRow(o);
    const i = index[String(row[0])];
    if (i === undefined) {
      index[String(row[0])] = data.length;
      data.push(row);
      changed = true;
    } else if (Number(data[i][updatedIdx]) <= Number(row[updatedIdx]) && !(keep && keep(data[i], row))) {
      data[i] = row;
      changed = true;
    }
  });
  if (changed) sh.getRange(2, 1, data.length, width).setValues(data);
}

function appendNew_(name, objects, toRow) {
  if (!objects.length) return;
  const sh = sheet_(name);
  const seen = {};
  readAll_(name).forEach(function (r) { seen[String(r[0])] = true; });
  const rows = objects.filter(function (o) { return !seen[String(o.id)]; }).map(toRow);
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, SHEETS[name].length).setValues(rows);
}

function changed_(name, since) {
  const at = SHEETS[name].indexOf('ServerAt');
  return readAll_(name).filter(function (r) { return Number(r[at]) > since; });
}

/** Code sort: by category, then numeric codes as numbers, then text. */
function byCode_(a, b, catIdx, codeIdx) {
  if (a[catIdx] !== b[catIdx]) return a[catIdx] < b[catIdx] ? -1 : 1;
  const na = Number(a[codeIdx]), nb = Number(b[codeIdx]);
  if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
  return String(a[codeIdx]) < String(b[codeIdx]) ? -1 : String(a[codeIdx]) > String(b[codeIdx]) ? 1 : 0;
}

/**
 * Rebuilds the two summary tabs from Items:
 * Stock, one row per code with where it is kept, and By location, one row per location and code.
 */
function stockSheet_() {
  const ss = SpreadsheetApp.getActive();
  const NONE = 'No location';
  const groups = {};
  const places = {};
  // Show group names instead of IDs when the Groups tab has them.
  const groupName = {};
  if (ss.getSheetByName('Groups')) readAll_('Groups').forEach(function (g) { if (g[0]) groupName[String(g[0])] = String(g[1] || g[0]); });
  readAll_('Items').forEach(function (r) {
    if (r[7] !== 'IN_STOCK') return;
    const cat = groupName[String(r[1])] || r[1];
    const key = [cat, r[2], r[3], r[6]].join('|');
    if (!groups[key]) groups[key] = { row: [cat, r[2], r[3], r[6], 0, 0], where: {} };
    const g = groups[key];
    const loc = String(r[13] || '').trim() || NONE;
    g.row[4] += 1;
    g.row[5] += Number(r[5]) || 0;
    g.where[loc] = (g.where[loc] || 0) + 1;
    const pkey = [loc, key].join('|');
    if (!places[pkey]) places[pkey] = [loc, cat, r[2], r[3], r[6], 0, 0];
    places[pkey][5] += 1;
    places[pkey][6] += Number(r[5]) || 0;
  });
  const updated = 'Updated ' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm');

  const stockRows = Object.keys(groups).map(function (k) {
    const g = groups[k];
    const where = Object.keys(g.where)
      .sort(function (a, b) { return g.where[b] - g.where[a]; })
      .map(function (loc) { return loc + ': ' + g.where[loc]; })
      .join(', ');
    return g.row.concat([where]);
  }).sort(function (a, b) { return byCode_(a, b, 0, 1); });
  writeSummary_(ss, 'Stock', 0, ['Category', 'Code', 'Size', 'Unit', 'Packages', 'Total', 'Locations'], stockRows, updated);

  const placeRows = Object.keys(places).map(function (k) { return places[k]; }).sort(function (a, b) {
    if (a[0] !== b[0]) {
      if (a[0] === NONE) return 1;
      if (b[0] === NONE) return -1;
      return a[0] < b[0] ? -1 : 1;
    }
    return byCode_(a, b, 1, 2);
  });
  writeSummary_(ss, 'By location', 1, ['Location', 'Category', 'Code', 'Size', 'Unit', 'Packages', 'Total'], placeRows, updated);
}

function writeSummary_(ss, name, position, headers, rows, updated) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name, position);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sh.getRange(1, headers.length + 2).setValue(updated);
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sh.setFrozenRows(1);
}

/** IDs of ship-outs, cuts and write-offs cancelled in the app: each has an UNDO row whose Reference is its ID. */
function undone_(moves) {
  const undone = {};
  moves.forEach(function (r) { if (r[2] === 'UNDO') undone[String(r[7])] = true; });
  return undone;
}

/** Out by day: what left the warehouse each day (shipped and cut), per code. Newest day first. */
function outSheet_() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const groups = {};
  const moves = readAll_('Movements');
  const undone = undone_(moves);
  moves.forEach(function (r) {
    if ((r[2] !== 'OUT' && r[2] !== 'CUT') || undone[String(r[0])]) return;
    const day = Utilities.formatDate(new Date(ms_(r[8])), tz, 'yyyy-MM-dd');
    const key = [day, r[5], r[6], r[4]].join('|');
    if (!groups[key]) groups[key] = { row: [day, String(r[5]), String(r[6]), r[4], 0, 0], items: {}, refs: {}, by: {} };
    const g = groups[key];
    g.items[r[1]] = true;
    g.row[5] += Number(r[3]) || 0;
    if (String(r[7]).trim()) g.refs[String(r[7]).trim()] = true;
    g.by[String(r[11] || '').trim() || ('phone ' + r[9])] = true;
  });
  const rows = Object.keys(groups).map(function (k) {
    const g = groups[k];
    g.row[4] = Object.keys(g.items).length;
    return g.row.concat([Object.keys(g.refs).join(', '), Object.keys(g.by).join(', ')]);
  }).sort(function (a, b) {
    if (a[0] !== b[0]) return a[0] < b[0] ? 1 : -1;
    return byCode_(a, b, 3, 1);
  });
  writeSummary_(ss, 'Out by day', 2, ['Date', 'Code', 'Size', 'Unit', 'Packages', 'Total', 'Customer / invoice', 'By'], rows,
    'Updated ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'));
}

/** Cuts: every cut for a customer, every short end written off and every damage report, newest first. */
function cutsSheet_() {
  const ss = SpreadsheetApp.getActive();
  const tz = ss.getSpreadsheetTimeZone();
  const moves = readAll_('Movements');
  const undone = undone_(moves);
  const rows = moves.filter(function (r) {
    return (r[2] === 'CUT' || r[2] === 'WASTE' || r[2] === 'DAMAGE') && !undone[String(r[0])];
  }).sort(function (a, b) { return ms_(b[8]) - ms_(a[8]); }).map(function (r) {
    // A damage report has no customer; its reason (from the Reference column) takes that place.
    return [Utilities.formatDate(new Date(ms_(r[8])), tz, 'yyyy-MM-dd HH:mm'), r[2] === 'CUT' ? 'Cut' : (r[2] === 'DAMAGE' ? 'Damage' : 'Waste'),
            r[2] === 'DAMAGE' ? String(r[7] || '') : String(r[12] || ''), String(r[13] || ''), String(r[5]), String(r[6]), Number(r[3]) || 0, r[4], r[1],
            String(r[11] || '').trim() || ('phone ' + r[9])];
  });
  writeSummary_(ss, 'Cuts', 3, ['Date', 'Type', 'Customer / reason', 'Invoice', 'Code', 'Size', 'Length', 'Unit', 'Roll', 'By'], rows,
    'Updated ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'));
}

// ---------- weekly backup ----------

function weeklyBackup() {
  const ss = SpreadsheetApp.getActive();
  const folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER);
  const stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + ' backup ' + stamp, folder);

  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });
}

// ---------- values ----------

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function date_(ms) { return ms ? new Date(Number(ms)) : ''; }
function ms_(v) { return v instanceof Date ? v.getTime() : Number(v) || 0; }
function num_(v) { return v === '' || v === null || isNaN(Number(v)) ? null : Number(v); }
function yes_(v) { return v === true || /^(true|yes|y|1|x)$/i.test(String(v).trim()); }
function blank_(v) { return v === null || v === undefined ? '' : v; }
