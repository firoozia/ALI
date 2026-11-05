// A static guard for the files tests do not import (index.js starts the whole program): a literal backslash-n pasted into a
// comment by an edit once commented out the next statement, and "x is not defined" only showed in production. Two checks:
//  1. no comment holds a literal backslash-n followed by code;
//  2. every name used as a call or as an object in src/*.js is declared somewhere in the same file (or is a known global).
// It is deliberately rough (no scopes), so a name declared in ANOTHER function still counts as declared, but a name declared
// nowhere in its file fails the suite.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join(import.meta.dirname, '..', 'src');
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));
const BS = String.fromCharCode(92);

// block comment | line comment | 'string' | "string" | `template` | regex literal (right after an operator or a bracket)
const TOKEN = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`|(?<=[=>(,:;!&|?{}[]\s*)\/(?![/*])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[a-z]*/g;
/** The source without comments, strings, template text and regex literals (replaced by spaces), so names can be scanned. */
const strip = (src) => src.replace(TOKEN, (m) => m.replace(/[^\n]/g, ' '));

const GLOBALS = new Set(['console', 'process', 'Buffer', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch', 'URL', 'URLSearchParams', 'AbortController',
  'Date', 'Math', 'JSON', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Error', 'RegExp', 'Symbol', 'Intl', 'parseInt', 'parseFloat',
  'isNaN', 'Uint8Array', 'TextDecoder', 'TextEncoder', 'structuredClone', 'queueMicrotask', 'globalThis', 'BigInt', 'AggregateError', 'TypeError', 'RangeError',
  'encodeURIComponent', 'decodeURIComponent', 'AbortSignal', 'FormData', 'Headers', 'Response', 'Request', 'require', 'import', 'super', 'this', 'await', 'async', 'constructor']);
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'delete', 'void', 'in', 'of', 'instanceof', 'else', 'do', 'case', 'throw', 'yield', 'class', 'const', 'let', 'var', 'from', 'as', 'default', 'try', 'finally', 'break', 'continue', 'static', 'get', 'set', 'export', 'extends']);

// Names the rough scanner cannot see being declared: a parameter inside a template literal nested in another one.
const KNOWN = { 'guard.js': ['log'], 'morning.js': ['learnedLang', 'log'], 'report.js': ['x'], 'image.js': ['code'], 'stock.js': ['info'] }; // image.js: text inside a prompt template; stock.js: a parameter whose default holds braces

function declared(code) {
  const names = new Set();
  const add = (s) => { for (const m of String(s).matchAll(/[A-Za-z_$][\w$]*/g)) names.add(m[0]); };
  // const/let/var: the binding (a name, or a destructuring pattern) up to = / of / in / ;
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([\s\S]*?)(?=\s=[^=>]|\sof\s|\sin\s|;|\n)/g)) add(m[1]);
  for (const m of code.matchAll(/\b(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/\bimport\s+([\s\S]*?)\s+from\b/g)) add(m[1]);
  // parameters: function (...), name(...) { methods, (...) =>, x =>, catch (e)
  for (const m of code.matchAll(/\bfunction\*?\s*[\w$]*\s*\(([^)]*)\)/g)) add(m[1]);
  for (const m of code.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of code.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) names.add(m[1]);
  for (const m of code.matchAll(/\bcatch\s*\(\s*([\w$]+)/g)) names.add(m[1]);
  for (const m of code.matchAll(/^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\((.*)\)\s*\{/gm)) { names.add(m[1]); add(m[2]); }
  for (const m of code.matchAll(/\(\s*\{([^}]*)\}\s*(?:=\s*\{\s*\})?\s*\)\s*(?:=>|\{)/g)) add(m[1]);
  // a destructuring pattern with defaults, as a declaration or a parameter: { a, b = 1 } = ctx
  for (const m of code.matchAll(/\{([^{}]*)\}\s*=\s*[^=>]/g)) add(m[1]);
  return names;
}

function undefinedNames(src) {
  const code = strip(src);
  const have = declared(code);
  const bad = new Set();
  for (const m of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?=\(|\.(?!\.))/g)) {
    const name = m[1];
    if (KEYWORDS.has(name) || GLOBALS.has(name) || have.has(name)) continue;
    bad.add(name);
  }
  return [...bad];
}

test('no comment in src holds a literal backslash-n followed by code', () => {
  const bad = [];
  const re = new RegExp(`${BS}${BS}n\\s*(const|let|var|import|export|await|function|if|for|return|class|async)\\b`);
  for (const f of files) {
    fs.readFileSync(path.join(SRC, f), 'utf8').split('\n').forEach((line, i) => {
      const at = line.indexOf('//');
      if (at >= 0 && re.test(line.slice(at))) bad.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});

test('every name called or used as an object in src is declared in its file', () => {
  const bad = {};
  for (const f of files) {
    const missing = undefinedNames(fs.readFileSync(path.join(SRC, f), 'utf8')).filter((n) => !(KNOWN[f] || []).includes(n));
    if (missing.length) bad[f] = missing;
  }
  assert.deepEqual(bad, {});
});

test('the guard itself sees an undeclared name and a commented-out declaration', () => {
  const broken = `const a = 1; // rule${BS}nconst aliases = new X();\nfoo(aliases.get(a));`;
  assert.deepEqual(undefinedNames(broken).sort(), ['aliases', 'foo']); // the new X() after the pasted backslash-n is inside the comment
  assert.deepEqual(undefinedNames('import { x } from "y";\nconst f = (p, { q }) => p + q;\nx(f(1, {q: 2})); try {} catch (e) { console.log(e.message); }'), []);
});
