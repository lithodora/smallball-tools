/**
 * SmallBall Tournament (v2.9: random seeding keeps one owner's clubs apart (opposite halves, as late a meeting as the bracket allows); v2.8: 🧪 Mock tournament: plays a whole pretend bracket through the real Discord posts, then 🗑️ deletes them; v2.7: every time says its zone (MT in the Sheet and form, "your time" in Discord, your zone on the pages); MAX_PER_OWNER lets an owner enter more than one club (🛠 Allow two clubs per owner); v2.6: 🏦 Prize Vault: club 1008's ticket tray published hourly for the Prize Vault page, with donors credited automatically, and a 🎁 Donate link on every bracket board; v2.5: ⛳ Scramble matches are 18 holes of match play from the box scores, with birdie/eagle scorecards (🔑 Connect SmallBall box scores; Nassau if they can't be read); v2.4: 📣 announcement menu item, 🔎 matchup cards; v2.3: ⛳ Two Man Scramble format (two-club teams, Nassau scoring) with its own golf-course bracket page; v2.2: the 🆕 New tournament pop-up is back, with run-alongside; v2.1: several tournaments at once in one Sheet, each with its own form, tabs and page; v2.0: Tournament Central: one Sheet runs tournament after tournament (🆕 New tournament), a ✅ Health check, and a Tournaments page; v1.4: the live bracket can live on GitHub Pages; v1.3: sleeps when nothing is due, to save Google run time; v1.2: a bracket preview while sign-ups are open; v1.1: blank-form sign-ups for returning players) · by Slip (slipnsliders) for the SmallBall community
 * A Google Sheet + Form + Apps Script that runs a SmallBall tournament on its own:
 *   sign-ups on a Google Form → a seeded bracket → fixed waves of matches → BigLeague games found on
 *   SmallBall automatically → results posted to Discord once each game has aired (no spoilers) → a live
 *   bracket web page with a "save as image" button. No-shows and ties are handled by the rules below, so
 *   it keeps running when the organizer is away.
 * Read-only on SmallBall: it only reads the public game list (/games/all?club=ID). It never plays,
 * trains or saves anything there. Owners play their own matches.
 *
 * SETUP: Extensions → Apps Script, paste this file, Save. Run `setup` once (approve). Fill in Config.
 * Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone) for the live bracket.
 */

// ===================== Settings (the Config tab) =====================
const DEFAULTS = {
  TOURNEY_NAME: ['Black Friday Brawl', 'Shown everywhere'],
  DISCORD_WEBHOOK_URL: ['', 'Discord channel → Edit Channel → Integrations → Webhooks → New Webhook → Copy URL'],
  LOG_WEBHOOK_URL: ['', 'Optional: a private channel that gets the Log (errors, rejections)'],
  FORMAT: ['double', 'double (double elimination), single (single elimination) or scramble (⛳ two-club teams, 18 holes of match play)'],
  GRAND_FINAL_RESET: ['yes', 'Double elimination: if the losers-bracket champ wins the grand final, play once more (yes/no)'],
  SEEDING: ['signup', 'signup (sign-up order), stars (most stars first) or random'],
  SIGNUP_CLOSE: ['2026-11-26 21:00', 'Sign-ups close and the bracket is drawn (yyyy-MM-dd HH:mm, Mountain time)'],
  START: ['2026-11-27 09:00', 'Wave 1 starts (yyyy-MM-dd HH:mm, Mountain time)'],
  WAVE_MINUTES: ['60', 'Minutes to play each match. Wave 1 opens at START; after that a match opens as soon as both clubs are known'],
  ALLOWED_KINDS: ['big', 'Game types that count, comma separated: big, pro, exhibition'],
  POST_DELAY_MINUTES: ['25', 'Results post this long after the game is played, once it has aired (official games air about 22 minutes)'],
  NO_SHOW: ['higher seed', 'No game in the match window: "higher seed" moves on automatically, or "commish" waits for you'],
  TIE_RULE: ['replay', 'A tie: "replay" (play again; the match gets 30 more minutes) or "higher seed"'],
  MAX_CLUBS: ['32', 'Sign-ups stop at this many clubs'],
  MAX_PER_OWNER: ['1', 'How many clubs one owner (one Google sign-in) can enter'],
  PREVIEW_SIZE: ['16', 'While sign-ups are open, the bracket page shows a preview bracket this big (16 = no byes). It grows to 32 if more sign up'],
  MIN_STARS: ['0', 'Lowest club stars allowed (0 = anyone)'],
  MAX_STARS: ['10', 'Highest club stars allowed'],
  FORM_LINK: ['', 'Short link to the sign-up form (filled in by setup; swap in a tinyurl if you like)'],
  BOARD_LINK: ['', 'Link to the live bracket for Discord posts. Blank = the web app link, found on its own'],
  PRIZES: ['SmallBall Tickets and pictures of dogs', 'Shown on the bracket and the champion post'],
  HILL_SHEET_ID: ['', 'Optional: the Hold the Hill spreadsheet ID (the long code in its link). Hill players can then sign up with a blank form'],
  FORM_ID: ['', '(set by setup)'],
  TZ: ['America/Denver', 'Time zone for the times above'],
  GITHUB_REPO: ['slipnsliders/smallball-tools', 'Optional: the GitHub repo that hosts the bracket page (owner/repo). Connect it from the 🏆 Tournament menu'],
  GITHUB_PATH: ['docs/brawl/bracket.json', 'Where the bracket data goes in that repo (the page sits next to it)'],
  SLUG: ['', 'Short web name for this tournament (set by 🆕 New tournament)'],
  SCRAMBLE_SCORING: ['holes', 'Scramble only: holes (18 holes of match play from the box scores; needs 🔑 Connect SmallBall box scores) or nassau'],
  TOURNAMENTS_PATH: ['docs/tournaments/index.json', 'The Tournaments page\'s list in the GitHub repo. Every tournament adds itself; past champions stay'],
};
const SHEETS = { CONFIG: 'Config', ROSTER: 'Roster', ENTRANTS: 'Entrants', MATCHES: 'Matches', LOG: 'Log', STATE: 'State', BOARD: 'Board' };
const ENTRANT_COLS = ['Email', 'Discord', 'DiscordID', 'Owner', 'Club', 'ClubID', 'Stars', 'Joined', 'Status', 'Seed'];
// Everyone who has ever signed up here (it comes along when you copy this Sheet for the next tournament).
const ROSTER_COLS = ['Email', 'Discord', 'DiscordID', 'Owner', 'Club', 'ClubID', 'Stars', 'LastSeen'];
const FORM_DESC = 'Played before, or on Hold the Hill? Just submit: leave the boxes blank and we fill them in from your record (your Google sign-in tells us who you are). Fill in only what\'s new, like a different club.\n\nOne club per owner. BigLeague games only. Read-only: the tournament reads SmallBall\'s public game list and never plays or saves anything for you.';
const Q = {
  DISCORD: 'Discord username',
  DISCORD_ID: 'Discord user ID (optional: lets the bracket @tag you when your match opens)',
  OWNER: 'SmallBall owner name',
  CLUB: 'Club name',
  CLUB_ID: 'Club ID # (one club per owner)',
  STARS: 'Club stars (0-10, shown on your SmallBall club page)',
  PARTNER: 'Partner (optional: their Discord name or club ID)',
};
const BYE = -1;

// ===================== Small helpers =====================
const norm_ = (v) => String(v == null ? '' : v).trim();
const lc_ = (v) => norm_(v).toLowerCase();
const esc_ = (s) => norm_(s).replace(/([*_~`|>\\])/g, '\\$1');   // Discord markdown
const now_ = () => new Date();
function fail_(msg) { const e = new Error(msg); e.userFacing = true; throw e; }

function ss_() { return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(props_().getProperty('SHEET_ID')); }
function sheet_(name, header) {
  name = tab_(name);
  const ss = ss_(); let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); if (header) { sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold'); sh.setFrozenRows(1); } }
  return sh;
}
let CFG_CACHE = null;
// ===================== Several tournaments in one Sheet =====================
// Each tournament lives in a "slot". The first one uses the plain tabs (Config, Entrants, Matches, State, Board);
// the others get their own copies ("Config #2", "Entrants #2"...), their own sign-up form and their own page.
// Roster, History and Log are shared. CUR_ is the slot being worked on (null = the first one).
let CUR_ = null;
const PER_T_ = { Config: 1, Entrants: 1, Matches: 1, State: 1, Board: 1 };
const NEW_HTML_ = `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_top"><style>
body{font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2430;margin:0;padding:4px 6px}
label{display:block;font-weight:600;margin:10px 0 3px}small{color:#5b6475;font-weight:400}
input,select,textarea{width:100%;box-sizing:border-box;font:inherit;padding:6px 8px;border:1px solid #c7ccd6;border-radius:6px}
.row{display:flex;gap:10px}.row>div{flex:1}.chk{display:flex;gap:8px;align-items:flex-start;font-weight:400;margin-top:10px}.chk input{width:auto;margin-top:3px}
.note{background:#fff7e0;border:1px solid #f0d58a;border-radius:8px;padding:8px 10px;margin:4px 0 8px}.bad{background:#fde8e8;border-color:#f1a3a3}
button{background:#1a73e8;color:#fff;border:0;border-radius:6px;padding:9px 18px;font:600 14px system-ui;margin-top:14px;cursor:pointer}button[disabled]{opacity:.5}
#out{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:12px}.kinds label{display:inline-flex;gap:5px;font-weight:400;margin-right:12px}.kinds input{width:auto}
</style></head><body>
<div id="state"></div>
<label>Where</label><select id="slot"></select><div id="slotNote" class="note" style="display:none"></div>
<label>Name <small>shown everywhere, e.g. "New Year's Knockout"</small></label><input id="name" maxlength="60">
<div class="row"><div><label>Sign-ups close</label><input id="close" type="datetime-local"></div><div><label>Wave 1 starts</label><input id="start" type="datetime-local"></div></div>
<div class="row"><div><label>Minutes per match</label><input id="wave" type="number" min="15" max="1440"></div>
<div><label>Format</label><select id="fmt"><option value="double">Double elimination</option><option value="single">Single elimination</option><option value="scramble">⛳ Two Man Scramble (teams, Nassau)</option></select></div></div>
<label>Game types that count</label><div class="kinds"><label><input type="checkbox" value="big">BigLeague</label><label><input type="checkbox" value="pro">Pro</label><label><input type="checkbox" value="exhibition">Exhibition</label></div>
<div class="row"><div><label>Stars from</label><input id="minS" type="number" min="0" max="10"></div><div><label>to</label><input id="maxS" type="number" min="0" max="10"></div><div><label>Max clubs</label><input id="max" type="number" min="2" max="64"></div></div>
<label>Prizes</label><input id="prizes">
<label>Different Discord channel? <small>paste its webhook; blank = same channel as now</small></label><input id="webhook" placeholder="https://discord.com/api/webhooks/...">
<label class="chk"><input type="checkbox" id="announce" checked><span>Post the sign-ups-open announcement to Discord</span></label>
<button id="go">🆕 Start it</button><div id="out"></div>
<script>
var I=__INIT__;function $(i){return document.getElementById(i)}
var st=$('state'),sel=$('slot');
var o0=document.createElement('option');o0.value='new';o0.textContent='➕ Alongside the others (its own sign-up form)';sel.appendChild(o0);
I.slots.forEach(function(x){if(x.live)return;var o=document.createElement('option');o.value=x.slot;o.textContent='♻️ Replace: '+x.name+' ('+x.status+') · keeps its sign-up link';sel.appendChild(o);});
var live=I.slots.filter(function(x){return x.live}).map(function(x){return x.name});
if(live.length){st.className='note';st.textContent='Being played now: '+live.join(', ')+'. A new one runs alongside without touching '+(live.length>1?'them':'it')+'.';}
sel.onchange=function(){var x=I.slots.filter(function(y){return String(y.slot)===sel.value})[0],n=$('slotNote');
  if(!x){n.style.display='none';return}n.style.display='block';n.className='note'+(x.played?'':' bad');
  n.textContent=x.played?'The '+x.name+' is saved to the History tab and its bracket page stays up for good.':'The '+x.name+' was never played: its '+x.signups+' sign-up(s) go to the History tab and it comes off the Tournaments page.';};
$('wave').value=I.wave;$('fmt').value=I.fmt;$('minS').value=I.minS;$('maxS').value=I.maxS;$('max').value=I.max;$('prizes').value=I.prizes;
I.kinds.split(',').forEach(function(k){var b=document.querySelector('.kinds input[value="'+k.trim()+'"]');if(b)b.checked=true});
$('go').onclick=function(){
  var kinds=[].slice.call(document.querySelectorAll('.kinds input:checked')).map(function(b){return b.value}).join(',');
  var o={slot:sel.value,name:$('name').value,close:$('close').value,start:$('start').value,wave:$('wave').value,fmt:$('fmt').value,kinds:kinds,minS:$('minS').value,maxS:$('maxS').value,max:$('max').value,prizes:$('prizes').value,webhook:$('webhook').value,announce:$('announce').checked,replace:sel.value!=='new'};
  $('go').disabled=true;$('out').textContent='Working… (archiving, setting up the form and page)';
  google.script.run.withSuccessHandler(function(r){
    var icon={ok:'✅',warn:'⚠️',bad:'❌'};
    $('out').textContent='🎉 '+r.name+' is set up'+(r.archived?' ('+r.archived+' saved to History)':'')+(r.alongside?', running alongside the others. The menu now works on it (🔀 to switch; reload the Sheet to see the new menu name).':'.')+'\\n\\nBracket page: '+r.url+'\\nSign-up form'+(r.alongside?' (its own, new link)':' (same link as before)')+': '+r.form+(r.alongside?'\\n👥 One check on the new form: Published → Responders → Anyone with the link (business-account forms start company-only).':'')+'\\n\\nHealth check:\\n'+r.health.map(function(x){return icon[x.s]+' '+x.t+(x.s!=='ok'&&x.fix?'\\n     → '+x.fix:'')}).join('\\n');
  }).withFailureHandler(function(e){$('go').disabled=false;var m=String(e&&e.message||e);
    $('out').textContent=/PERMISSION_DENIED|reading from storage/i.test(m)?'❌ Google blocked this box because Chrome is signed in to several Google accounts and this Sheet\\'s account isn\\'t the main one.\\n\\nFix: open the Sheet in a window signed in only to the account that owns it (an Incognito window works), then try again. Or close this and use 🆕 New tournament (question boxes) from the menu.\\n\\nNothing was changed.':'❌ '+m;}).newTournament(o);
};
</script></body></html>`;

const SHARED_PROPS_ = { GITHUB_TOKEN: 1, GH_BAD: 1, SHEET_ID: 1, SLOTS: 1, ADMIN_SLOT: 1, SB_COOKIE: 1, SB_BAD: 1 };
const tab_ = (name) => (CUR_ && PER_T_[name] ? name + ' #' + CUR_ : name);
function props_() {
  const p = PropertiesService['getScriptProperties'](), k = (key) => (CUR_ && !SHARED_PROPS_[key] ? key + '#' + CUR_ : key);
  return { getProperty: (key) => p.getProperty(k(key)), setProperty: (key, v) => p.setProperty(k(key), v), deleteProperty: (key) => p.deleteProperty(k(key)) };
}
function slots_() { let x = []; try { x = JSON.parse(PropertiesService['getScriptProperties']().getProperty('SLOTS') || '[]'); } catch (e) { } return [null].concat(x); }
function withSlot_(slot, fn) { const prev = CUR_; CUR_ = slot || null; CFG_CACHE = null; try { return fn(); } finally { CUR_ = prev; CFG_CACHE = null; } }
function adminSlot_() { const s = PropertiesService['getScriptProperties']().getProperty('ADMIN_SLOT'); return s && slots_().indexOf(s) >= 0 ? s : null; }
function cfg_() {
  if (CFG_CACHE) return CFG_CACHE;
  const sh = sheet_(SHEETS.CONFIG, ['Key', 'Value', 'Notes']);
  const vals = sh.getDataRange().getValues(), C = {};
  for (let i = 1; i < vals.length; i++) if (vals[i][0]) C[norm_(vals[i][0])] = vals[i][1];
  Object.keys(DEFAULTS).forEach((k) => { if (C[k] === undefined || C[k] === '') C[k] = C[k] === '' ? '' : DEFAULTS[k][0]; });
  CFG_CACHE = C; return C;
}
function setCfg_(key, value) {
  const sh = sheet_(SHEETS.CONFIG, ['Key', 'Value', 'Notes']), vals = sh.getDataRange().getValues();
  for (let i = 1; i < vals.length; i++) if (norm_(vals[i][0]) === key) { sh.getRange(i + 1, 2).setValue(value); CFG_CACHE = null; return; }
  sh.appendRow([key, value, DEFAULTS[key] ? DEFAULTS[key][1] : '']); CFG_CACHE = null;
}
function tz_(C) { return norm_((C || cfg_()).TZ) || 'America/Denver'; }
// A Config time: a real date (Sheets may turn it into one) or "yyyy-MM-dd HH:mm" in the tournament's time zone.
function when_(v, C) {
  if (v instanceof Date) return v.getTime();
  const s = norm_(v); if (!s) return 0;
  try { return Utilities.parseDate(s.replace('T', ' ').slice(0, 16), tz_(C), 'yyyy-MM-dd HH:mm').getTime(); } catch (e) { return Date.parse(s) || 0; }
}
const fmtT_ = (t, C) => Utilities.formatDate(new Date(t), tz_(C), 'EEE h:mm a z');   // always with its zone (MST/MDT), so nobody guesses
const ts_ = (t) => '<t:' + Math.floor(t / 1000) + ':t> your time';      // Discord shows it in each reader's own time zone: say so
const tsR_ = (t) => '<t:' + Math.floor(t / 1000) + ':R>';

function log_(actor, action, details) {
  try {
    const sh = sheet_(SHEETS.LOG, ['Time', 'Actor', 'Action', 'Details']);
    const C = cfg_(); if (CUR_) action = '[' + norm_(C.TOURNEY_NAME) + '] ' + action;
    sh.appendRow([now_(), actor, action, norm_(details).slice(0, 4000)]);
    if (norm_(C.LOG_WEBHOOK_URL) && !/^Discord/.test(action)) queueLog_('`' + action + '` ' + norm_(details).slice(0, 300));
  } catch (e) { }
}
function queueLog_(line) {
  const p = props_();
  let q = []; try { q = JSON.parse(p.getProperty('LOG_QUEUE') || '[]'); } catch (e) { }
  q.push(line); p.setProperty('LOG_QUEUE', JSON.stringify(q.slice(-60)));
}
function flushLog_() {
  const p = props_(), C = cfg_(), url = norm_(C.LOG_WEBHOOK_URL);
  let q = []; try { q = JSON.parse(p.getProperty('LOG_QUEUE') || '[]'); } catch (e) { }
  if (!q.length || !url) return;
  p.setProperty('LOG_QUEUE', '[]');
  sendChunk_(url, '🏆 Tournament log', q.join('\n').slice(0, 1900));
}

// ===================== Discord =====================
function webhook_(C) { return norm_(C.DISCORD_WEBHOOK_URL); }
// One message to one webhook. Returns the HTTP code (0 = it never got there).
function sendChunk_(url, name, chunk, embeds) {
  const send = (text) => UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify(Object.assign({ content: text, username: name, allowed_mentions: { parse: ['users'] } }, embeds ? { embeds } : {})) });
  let res, code;
  try { res = send(chunk); code = res.getResponseCode(); } catch (e) { log_('system', 'Discord error', String(e)); return 0; }
  // "error code: 1015" is Cloudflare briefly blocking Google's servers: the retry queue handles that one.
  for (let tries = 0; code === 429 && tries < 2 && !/1015/.test(res.getContentText()); tries++) {
    let wait = 1.5; try { wait = Number(JSON.parse(res.getContentText()).retry_after) || 1.5; } catch (e) { }
    Utilities.sleep(Math.min(8, wait + 0.25) * 1000); res = send(chunk); code = res.getResponseCode();
  }
  if (code >= 400 && code !== 429 && code < 500) {   // formatting Discord didn't like: send it plain
    const plain = chunk.replace(/\[([^\]]*)\]\(<?([^)>]+)>?\)/g, '$1 $2').replace(/`/g, '');
    if (plain !== chunk) { res = send(plain); code = res.getResponseCode(); }
  }
  if (code >= 300) log_('system', 'Discord error ' + code + (code === 429 || code >= 500 ? ' (will retry)' : ''), String(res.getContentText()).slice(0, 80) + ' · ' + chunk.slice(0, 120));
  return code;
}
function post_(content, embeds) {
  const C = cfg_(), url = webhook_(C);
  if (!url) { log_('system', 'Discord (no webhook set)', content); return; }
  const chunks = []; let s = content;
  while (s.length > 1900) { const cut = s.lastIndexOf('\n', 1900); const at = cut > 0 ? cut : 1900; chunks.push(s.slice(0, at)); s = s.slice(at); }
  chunks.push(s);
  chunks.forEach((chunk, i) => {
    const code = sendChunk_(url, norm_(C.TOURNEY_NAME) || 'Tournament', chunk, i === chunks.length - 1 ? embeds : null);
    if (code === 429 || code >= 500 || code === 0) queueRetry_(chunk);
  });
}
function queueRetry_(chunk) {
  const p = props_();
  let q = []; try { q = JSON.parse(p.getProperty('RETRY_POSTS') || '[]'); } catch (e) { }
  q.push({ text: chunk, n: 0, first: Date.now(), at: Date.now() + 60000 });
  p.setProperty('RETRY_POSTS', JSON.stringify(q.slice(-40)));
}
function flushRetries_() {
  const p = props_();
  let q = []; try { q = JSON.parse(p.getProperty('RETRY_POSTS') || '[]'); } catch (e) { }
  if (!q.length) return;
  const C = cfg_(), url = webhook_(C), t = Date.now(), keep = []; let blocked = false, sent = 0;
  q.forEach((x) => {
    if (!url || blocked || x.at > t || sent >= 5) { keep.push(x); return; }
    const code = sendChunk_(url, norm_(C.TOURNEY_NAME) || 'Tournament', x.text);
    if (code >= 200 && code < 300) { sent++; return; }
    if (code === 429 || code >= 500 || code === 0) {
      blocked = true;
      if (t - x.first > 6 * 3600e3) { log_('system', 'Discord gave up', x.text.slice(0, 300)); return; }
      x.n++; x.at = t + Math.min(10, Math.pow(2, x.n)) * 60000; keep.push(x);
    }
  });
  p.setProperty('RETRY_POSTS', JSON.stringify(keep));
}
function boardUrl_(C) {
  let u = norm_(C.BOARD_LINK);
  if (!u) try { u = ScriptApp.getService().getUrl() || ''; } catch (e) { u = ''; }
  return u;
}
function linksLine_(C) {
  C = C || cfg_();
  const b = boardUrl_(C), f = norm_(C.FORM_LINK), bits = [];
  if (b) bits.push('🗂️ [Live bracket](<' + b + '>)');
  if (f) bits.push('📝 [Sign-up form](<' + f + '>)');
  return bits.length ? '\n' + bits.join(' · ') : '';
}

// ===================== Entrants =====================
function readTable_(name, cols) {
  const sh = sheet_(name, cols), vals = sh.getDataRange().getValues(), head = vals[0].map(norm_), rows = [];
  for (let i = 1; i < vals.length; i++) {
    const r = { _row: i + 1 }; head.forEach((h, j) => { r[h] = vals[i][j]; }); if (head.some((h) => norm_(r[h]))) rows.push(r);
  }
  return { sh, head, rows };
}
function writeRow_(t, r) { t.sh.getRange(r._row, 1, 1, t.head.length).setValues([t.head.map((h) => (r[h] === undefined ? '' : r[h]))]); }
function appendRow_(t, r) { t.sh.appendRow(t.head.map((h) => (r[h] === undefined ? '' : r[h]))); }
function entrants_() { return readTable_(SHEETS.ENTRANTS, ENTRANT_COLS); }
const tag_ = (e) => (e && e.Tags ? e.Tags : e && /^\d{15,21}$/.test(norm_(e.DiscordID)) ? '<@' + norm_(e.DiscordID) + '>' : '**' + esc_(e ? e.Discord : '?') + '**');
const clubTxt_ = (e) => '*' + esc_(e.Club) + '* (club ID `' + norm_(e.ClubID) + '`' + (norm_(e.Stars) !== '' ? ' · ' + norm_(e.Stars) + '★' : '') + ')';

// ===================== The form =====================
// Each form's sign-ups go to its own tournament.
function onTourneyFormSubmit(e) {
  let fid = ''; try { fid = e.source.getId(); } catch (x) { }
  const slot = fid ? slots_().find((sl) => withSlot_(sl, () => norm_(cfg_().FORM_ID)) === fid) : null;
  return withSlot_(slot || null, () => submitOne_(e));
}
function submitOne_(e) {
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  let sub = null;
  try {
    sub = readSubmission_(e);
    register_(sub);
  } catch (err) {
    log_(sub ? sub.email : 'form', 'Rejected', String(err.message || err));
    if (err.userFacing) rejectPost_(sub, err.message);
    else rejectPost_(sub, 'Something went wrong on our end. The organizer has been flagged.');
  } finally { lock.releaseLock(); }
}
function readSubmission_(e) {
  const r = e && e.response; if (!r) fail_('No form response found.');
  const out = { email: lc_(r.getRespondentEmail()), a: {} };
  r.getItemResponses().forEach((ir) => { out.a[ir.getItem().getTitle()] = norm_(ir.getResponse()); });
  const pick = (k) => { if (out.a[k] !== undefined) return out.a[k]; const key = Object.keys(out.a).find((t) => t.toLowerCase().indexOf(k.toLowerCase().split(' (')[0]) === 0); return key ? out.a[key] : ''; };
  out.discord = pick(Q.DISCORD); out.discordId = pick(Q.DISCORD_ID); out.owner = pick(Q.OWNER); out.club = pick(Q.CLUB);
  out.clubId = pick(Q.CLUB_ID).replace(/[^\d]/g, ''); out.stars = pick(Q.STARS); out.partner = pick(Q.PARTNER);
  return out;
}
// What we already know about this Google account: this Sheet's Roster first, then the Hold the Hill sheet.
function knownPerson_(email, C) {
  const out = {};
  const take = (r) => { if (!r) return; ['Discord', 'DiscordID', 'Owner', 'Club', 'ClubID', 'Stars'].forEach((k) => { if (out[k] === undefined && norm_(r[k]) !== '') out[k] = norm_(r[k]); }); };
  try { take(readTable_(SHEETS.ROSTER, ROSTER_COLS).rows.find((r) => lc_(r.Email) === email)); } catch (e) { }
  if (norm_(C.HILL_SHEET_ID)) try {
    const hs = SpreadsheetApp.openById(norm_(C.HILL_SHEET_ID)), grab = (name) => { const sh = hs.getSheetByName(name); if (!sh) return []; const v = sh.getDataRange().getValues(), h = v[0].map(norm_); return v.slice(1).map((row) => { const o = {}; h.forEach((k, j) => { o[k] = row[j]; }); return o; }); };
    const p = grab('Players').find((r) => lc_(r.Email) === email);
    if (p) { take({ Discord: p.Discord, DiscordID: p.DiscordID, Owner: p.OwnerID, Club: p.Club, ClubID: p.ClubID });
      const st = grab('Stars').find((r) => norm_(r.ClubID) === norm_(p.ClubID)); if (st) take({ Stars: st.Stars }); }
  } catch (e) { log_('system', 'Hill sheet not readable', String(e.message || e)); }
  return out;
}
function remember_(rec) {
  const rt = readTable_(SHEETS.ROSTER, ROSTER_COLS), row = rt.rows.find((r) => lc_(r.Email) === rec.Email);
  const v = { Email: rec.Email, Discord: rec.Discord, DiscordID: rec.DiscordID, Owner: rec.Owner, Club: rec.Club, ClubID: rec.ClubID, Stars: rec.Stars, LastSeen: now_() };
  if (row) { Object.assign(row, v); writeRow_(rt, row); } else appendRow_(rt, v);
}
function register_(sub) {
  const C = cfg_(), t = Date.now();
  // Blank boxes are filled in from what we know about this Google account.
  if (sub.email) {
    const k = knownPerson_(sub.email, C), was = []; sub.knownId = norm_(k.DiscordID).replace(/[^\d]/g, '');
    if (!sub.discord && k.Discord) { sub.discord = k.Discord; was.push('Discord'); }
    if (!sub.discordId && k.DiscordID) { sub.discordId = k.DiscordID.replace(/[^\d]/g, ''); was.push('Discord ID'); }
    if (!sub.owner && k.Owner) { sub.owner = k.Owner; was.push('owner name'); }
    if (!sub.clubId && k.ClubID) { sub.clubId = k.ClubID.replace(/[^\d]/g, ''); if (!sub.club && k.Club) sub.club = k.Club; was.push('club'); }
    if (!sub.club && k.Club && sub.clubId === norm_(k.ClubID)) sub.club = k.Club;
    if (sub.stars === '' && k.Stars !== undefined && sub.clubId === norm_(k.ClubID)) sub.stars = k.Stars;
    sub.filled = was;
  }
  if (stateGet_()) fail_('Sign-ups are closed: the bracket has been drawn.');
  if (when_(C.SIGNUP_CLOSE, C) && t >= when_(C.SIGNUP_CLOSE, C)) fail_('Sign-ups closed ' + fmtT_(when_(C.SIGNUP_CLOSE, C), C) + '.');
  if (!sub.email) fail_('The form needs your Google sign-in (email) so you can update your entry.');
  if (!sub.discord || !sub.club || !sub.clubId) fail_('We need your ' + [!sub.discord && 'Discord username', !sub.club && 'club name', !sub.clubId && 'club ID'].filter(Boolean).join(', ') + '. We didn\'t have ' + (!sub.discord && !sub.club && !sub.clubId ? 'you' : 'that') + ' on record yet, so fill it in once and next time a blank form is enough.');
  const stars = sub.stars === '' ? '' : Number(sub.stars);
  if (stars !== '' && (isNaN(stars) || stars < 0 || stars > 10)) fail_('Club stars must be a number from 0 to 10.');
  if (stars !== '' && (stars < Number(C.MIN_STARS || 0) || stars > Number(C.MAX_STARS || 10))) fail_('This tournament is for ' + C.MIN_STARS + '–' + C.MAX_STARS + '★ clubs.');
  // A mistyped Discord ID doesn't cost anyone their spot: we skip it (or use the one on record) and say so.
  if (sub.discordId && !/^\d{15,21}$/.test(sub.discordId)) {
    sub.discordId = sub.knownId && /^\d{15,21}$/.test(sub.knownId) ? sub.knownId : '';
    sub.idNote = '\n-# That Discord user ID didn\'t look right (it\'s the long number from *Copy User ID*), so ' + (sub.discordId ? 'we used the one on record.' : 'we skipped it. Send the form again with it to get @tagged when your match opens.');
  }
  if (isScr_(C)) ensureCol_(SHEETS.ENTRANTS, 'Partner');
  const et = entrants_(), active = et.rows.filter((r) => r.Status !== 'Withdrawn');
  // One owner (Google sign-in) can enter up to MAX_PER_OWNER clubs. With one, sending the form again swaps your
  // club; with more, it updates that club's entry or adds another club, up to the limit.
  const per = Math.max(1, Number(C.MAX_PER_OWNER) || 1);
  const ownRows = et.rows.filter((r) => lc_(r.Email) === sub.email);
  const mine = per > 1 ? ownRows.find((r) => norm_(r.ClubID) === sub.clubId) : ownRows[0];
  const ownActive = ownRows.filter((r) => r.Status !== 'Withdrawn');
  if (per > 1 && !mine && ownActive.length >= per) fail_('You already have ' + per + ' clubs in: ' + ownActive.map((r) => r.Club + ' (' + r.ClubID + ')').join(' and ') + '. That\'s the most per owner. To swap one, ask the commish.');
  const clash = active.find((r) => norm_(r.ClubID) === sub.clubId && r !== mine);
  if (clash) fail_('Club ID ' + sub.clubId + ' is already signed up (' + clash.Discord + ').');
  if (!mine && active.length >= Number(C.MAX_CLUBS || 32)) fail_('The bracket is full (' + C.MAX_CLUBS + ' clubs).');
  // Is it a real club? The public game list answers for any club; a club with no games at all can't play anyway.
  let rows = null; try { rows = clubGames_(sub.clubId); } catch (e) { rows = null; }
  if (rows && !rows.length) fail_('SmallBall shows no games at all for club ID ' + sub.clubId + '. Check the number on your club page.');
  const rec = { Email: sub.email, Discord: sub.discord, DiscordID: sub.discordId || '', Owner: sub.owner, Club: sub.club, ClubID: sub.clubId, Stars: stars, Status: 'In' };
  if (isScr_(C)) rec.Partner = norm_(sub.partner).slice(0, 60);
  try { remember_(rec); } catch (e) { }
  const fromRecord = (sub.filled && sub.filled.length ? ' *(filled in from your record: ' + sub.filled.join(', ') + ')*' : '') + (sub.idNote || '');
  if (mine) { Object.assign(mine, rec); writeRow_(et, mine); log_(sub.email, 'Updated', sub.club + ' (' + sub.clubId + ')'); post_('✏️ ' + tag_(mine) + ' updated their entry: ' + clubTxt_(mine) + '.' + fromRecord); }
  else {
    rec.Joined = now_(); appendRow_(et, rec);
    const n = active.length + 1;
    log_(sub.email, 'Signed up', sub.club + ' (' + sub.clubId + ') #' + n);
    post_('🆕 ' + tag_(rec) + ' signs up with ' + clubTxt_(rec) + '. ' + (isScr_(C) ? '**' + n + '** club' + (n === 1 ? '' : 's') + ' on the tee sheet for the **' + esc_(C.TOURNEY_NAME) + '**' + (rec.Partner ? ' · 🤝 wants to play with **' + esc_(rec.Partner) + '**' : '') + '.' : '**' + n + ' of ' + Math.max(Number(C.PREVIEW_SIZE) || 16, pow2_(n)) + '** spots filled for the **' + esc_(C.TOURNEY_NAME) + '**.') + fromRecord +
      (when_(C.SIGNUP_CLOSE, C) ? '\n-# Sign-ups close ' + ts_(when_(C.SIGNUP_CLOSE, C)) + ' (' + tsR_(when_(C.SIGNUP_CLOSE, C)) + ').' : '') + linksLine_(C));
  }
  snapshot_();
}
function rejectPost_(sub, msg) {
  const C = cfg_(), who = sub && sub.discordId && /^\d{15,21}$/.test(sub.discordId) ? '<@' + sub.discordId + '> ' : sub && sub.discord ? '**' + esc_(sub.discord) + '** ' : '';
  post_(who + '❌ Your sign-up didn\'t go through.', [{ color: 0xC8102E, title: '❌ Sign-up rejected', description: msg + (norm_(C.FORM_LINK) ? '\n\n🔁 Fix it and [send the form again](<' + norm_(C.FORM_LINK) + '>)' : '') }]);
}

// ===================== Bracket engine (from the SmallBall Tournament Kit) =====================
function seedOrder_(n) { let a = [1]; while (a.length < n) { const m = a.length * 2 + 1, b = []; for (const s of a) b.push(s, m - s); a = b; } return a; }
const pow2_ = (n) => { let p = 1; while (p < n) p *= 2; return Math.max(2, p); };
const roundName_ = (left, kind) => left === 2 ? (kind ? kind + ' final' : 'Final') : left === 4 ? (kind ? kind + ' semifinal' : 'Semifinal') : left === 8 ? (kind ? kind + ' quarterfinal' : 'Quarterfinal') : (kind ? kind + ' r' : 'R') + 'ound of ' + left;
function buildSingle_(clubs, opt) {
  opt = opt || {};
  const n = pow2_(clubs.length), order = seedOrder_(n), M = [], pre = opt.prefix || '';
  let prev = [];
  for (let i = 0; i < n / 2; i++) {
    const sa = order[2 * i], sb = order[2 * i + 1];
    const m = { id: pre + 'R1M' + (i + 1), round: 1, slot: i, a: { club: clubs[sa - 1] != null ? clubs[sa - 1] : BYE }, b: { club: clubs[sb - 1] != null ? clubs[sb - 1] : BYE }, bracket: opt.bracket || 'W' };
    M.push(m); prev.push(m.id);
  }
  let r = 1, left = n;
  M.filter((m) => m.round === 1).forEach((m) => (m.label = roundName_(left, opt.kind) + ' · Match ' + (m.slot + 1)));
  while (prev.length > 1) {
    r++; left /= 2; const next = [];
    for (let i = 0; i < prev.length / 2; i++) {
      const m = { id: pre + 'R' + r + 'M' + (i + 1), round: r, slot: i, a: { from: prev[2 * i], take: 'W' }, b: { from: prev[2 * i + 1], take: 'W' }, bracket: opt.bracket || 'W', label: roundName_(left, opt.kind) + (prev.length > 2 ? ' · Match ' + (i + 1) : '') };
      M.push(m); next.push(m.id);
    }
    prev = next;
  }
  return { matches: M, final: prev[0], rounds: r };
}
function buildDouble_(clubs, reset) {
  const W = buildSingle_(clubs, { bracket: 'W', kind: 'Winners', prefix: 'W' });
  const M = W.matches.slice(), k = W.rounds, wb = (r) => W.matches.filter((m) => m.round === r).map((m) => m.id);
  let cur = [], li = 0;
  const r1 = wb(1);
  for (let i = 0; i < r1.length; i += 2) { const m = { id: 'LR1M' + (++li), round: 1, slot: li - 1, bracket: 'L', a: { from: r1[i], take: 'L' }, b: { from: r1[i + 1], take: 'L' } }; M.push(m); cur.push(m.id); }
  let lround = 1;
  for (let r = 2; r <= k; r++) {
    const drop = wb(r).slice().reverse(), next = []; lround++; li = 0;   // reversed to dodge quick rematches
    for (let i = 0; i < cur.length; i++) { const m = { id: 'LR' + lround + 'M' + (++li), round: lround, slot: li - 1, bracket: 'L', a: { from: cur[i], take: 'W' }, b: { from: drop[i], take: 'L' } }; M.push(m); next.push(m.id); }
    cur = next;
    if (cur.length > 1) {
      lround++; li = 0; const nx = [];
      for (let i = 0; i < cur.length; i += 2) { const m = { id: 'LR' + lround + 'M' + (++li), round: lround, slot: li - 1, bracket: 'L', a: { from: cur[i], take: 'W' }, b: { from: cur[i + 1], take: 'W' } }; M.push(m); nx.push(m.id); }
      cur = nx;
    }
  }
  const lTotal = lround;
  M.filter((m) => m.bracket === 'L').forEach((m) => { const left = M.filter((x) => x.bracket === 'L' && x.round === m.round).length; m.label = m.round === lTotal ? 'Losers final' : 'Losers round ' + m.round + (left > 1 ? ' · Match ' + (m.slot + 1) : ''); });
  M.push({ id: 'GF', round: 1, slot: 0, bracket: 'F', label: 'Grand final', a: { from: W.final, take: 'W' }, b: { from: cur[0], take: 'W' } });
  if (reset) M.push({ id: 'GF2', round: 2, slot: 0, bracket: 'F', label: 'Grand final, reset', resetOf: 'GF', a: { from: 'GF', take: 'W' }, b: { from: 'GF', take: 'L' } });
  return { matches: M, final: reset ? 'GF2' : 'GF', wRounds: k, lRounds: lTotal };
}
function sideClub_(T, side) {
  if (!side) return null;
  if (side.club != null) return side.club;
  const m = T.matches.find((x) => x.id === side.from); if (!m || !m.winner) return null;
  return side.take === 'L' ? m.loser : m.winner;
}
// Byes advance; a reset final is dropped when the winners-bracket champ wins the first grand final.
function settle_(T) {
  for (let pass = 0; pass < 60; pass++) {
    let changed = false;
    for (const m of T.matches) {
      if (m.winner || m.void) continue;
      if (m.resetOf) { const gf = T.matches.find((x) => x.id === m.resetOf); if (gf && gf.winner && gf.winner === sideClub_(T, gf.a)) { m.void = true; changed = true; continue; } }
      // A losers-bracket slot fed by a bye's "loser" is empty: the other side walks through.
      const a = sideClub_(T, m.a), b = sideClub_(T, m.b);
      if (a == null || b == null) continue;
      if (a === BYE || b === BYE) { m.winner = a === BYE ? b : a; m.loser = a === BYE ? a : b; m.bye = true; changed = true; }
    }
    if (!changed) break;
  }
}
function champion_(T) {
  if (T.fmt === 'double') {
    const gf = T.matches.find((m) => m.id === 'GF'), f2 = T.matches.find((m) => m.id === 'GF2');
    if (!gf || !gf.winner) return null;
    if (!f2) return gf.winner;
    if (f2.void) return gf.winner;
    return f2.winner || null;
  }
  const f = T.matches.find((m) => m.id === T.final); return f && f.winner > 0 ? f.winner : null;
}
function seededEntrants_(entrants, C) {
  const how = lc_(C.SEEDING), e = entrants.slice();
  if (how === 'stars') e.sort((a, b) => (Number(b.Stars) || 0) - (Number(a.Stars) || 0) || new Date(a.Joined) - new Date(b.Joined));
  else e.sort((a, b) => new Date(a.Joined) - new Date(b.Joined));   // random seeding: the preview shows sign-up order
  return e;
}
function createTournament_(entrants, C) {
  const how = lc_(C.SEEDING), e = entrants.slice();
  if (how === 'stars') e.sort((a, b) => (Number(b.Stars) || 0) - (Number(a.Stars) || 0) || new Date(a.Joined) - new Date(b.Joined));
  else if (how === 'random') { for (let i = e.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = e[i]; e[i] = e[j]; e[j] = x; } }
  else e.sort((a, b) => new Date(a.Joined) - new Date(b.Joined));
  const clubs = e.map((x) => Number(x.ClubID));
  let fmt = lc_(C.FORMAT) === 'single' ? 'single' : 'double';
  if (fmt === 'double' && clubs.length < 3) fmt = 'single';
  const T = { fmt, seeds: e.map((x, i) => ({ club: Number(x.ClubID), seed: i + 1 })), created: Date.now(), wave: 0, matches: [], final: null };
  const build = (cl) => (fmt === 'double' ? buildDouble_(cl, lc_(C.GRAND_FINAL_RESET) !== 'no') : buildSingle_(cl, {}));
  let built = build(clubs);
  // Random seeding: an owner with more than one club gets them spread apart, so they meet as late as possible.
  if (how === 'random') {
    const own = {}; e.forEach((x) => { const k = lc_(x.Email) || lc_(x.Discord) || String(x.ClubID); (own[k] = own[k] || []).push(Number(x.ClubID)); });
    const pairs = []; Object.keys(own).forEach((k) => { const c = own[k]; for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) pairs.push([c[i], c[j]]); });
    if (pairs.length) {
      let best = { cl: clubs, b: built, score: meetScore_(built.matches, pairs) };
      for (let t = 0; t < 600 && best.score > 0; t++) {
        const cl = clubs.slice(); for (let i = cl.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = cl[i]; cl[i] = cl[j]; cl[j] = x; }
        const b = build(cl), sc = meetScore_(b.matches, pairs);
        if (sc < best.score) best = { cl, b, score: sc };
      }
      clubs.splice(0, clubs.length, ...best.cl); built = best.b;
      T.seeds = clubs.map((c, i) => ({ club: c, seed: i + 1 }));
    }
  }
  Object.assign(T, built);
  settle_(T);
  return T;
}
// How early same-owner clubs could meet: for every match, which clubs could be on each side and how many games
// deep it is. Each pair scores more the earlier they could meet (0 = only in the last game or never).
function meetScore_(matches, pairs) {
  const by = {}; matches.forEach((m) => { by[m.id] = m; });
  const memo = {};
  const info = (id) => {
    if (memo[id]) return memo[id];
    const m = by[id], side = (sd) => (sd.from ? { set: info(sd.from).all, d: info(sd.from).d } : { set: sd.club > 0 ? [sd.club] : [], d: 0 });
    const a = side(m.a), b = side(m.b);
    return (memo[id] = { a: a.set, b: b.set, all: a.set.concat(b.set), d: 1 + Math.max(a.d, b.d) });
  };
  const all = matches.map((m) => info(m.id)), deep = Math.max.apply(null, all.map((x) => x.d));
  let score = 0;
  pairs.forEach(([x, y]) => {
    let first = deep + 1;
    all.forEach((m) => { if ((m.a.indexOf(x) >= 0 && m.b.indexOf(y) >= 0) || (m.a.indexOf(y) >= 0 && m.b.indexOf(x) >= 0)) first = Math.min(first, m.d); });
    score += Math.pow(Math.max(0, deep - first), 2);
  });
  return score;
}

// ===================== State =====================
function stateGet_() {
  const v = sheet_(SHEETS.STATE).getRange(1, 1).getValue();
  if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; }
}
function stateSet_(T) { sheet_(SHEETS.STATE).getRange(1, 1).setValue(T ? JSON.stringify(T) : ''); }
function entrantMap_() {
  const m = {}; entrants_().rows.forEach((r) => { if (r.Status !== 'Withdrawn') m[Number(r.ClubID)] = r; });
  const T = stateGet_();   // a scramble's teams answer to their team ID too
  if (T && T.teams) Object.keys(T.teams).forEach((k) => { const tm = T.teams[k]; m[Number(k)] = { Club: teamClubs_(m, tm), Discord: teamName_(m, tm), DiscordID: '', team: tm, Tags: tm.clubs.map((c) => tag_(m[c])).join(' & ') }; });
  return m;
}
const seedOf_ = (T, club) => { const s = T.seeds.find((x) => x.club === club); return s ? s.seed : 99; };
function nameOf_(E, T, club) { const e = E[club]; return e ? '#' + seedOf_(T, club) + ' ' + tag_(e) + ' (*' + esc_(e.Club) + '*)' : 'TBD'; }
function plainName_(E, club) { const e = E[club]; return e ? norm_(e.Club) : 'TBD'; }

// ===================== SmallBall =====================
function clubGames_(clubId) {
  const r = UrlFetchApp.fetch('https://play.smallball.com/games/all?club=' + encodeURIComponent(clubId), { muteHttpExceptions: true, headers: { Accept: 'application/json' } });
  if (r.getResponseCode() !== 200) throw new Error('SmallBall answered ' + r.getResponseCode());
  return (JSON.parse(r.getContentText()).rows || []);
}
const watchUrl_ = (gid) => 'https://play.smallball.com/training?watch=' + gid;

// ===================== The clock: runs every minute =====================
// Free Google accounts get about 90 minutes of trigger run time a day, shared by every script you own (Hold the
// Hill too). So the clock wakes every minute but only works when something is due: it writes down when that
// is (NEXT_AT) and goes straight back to sleep until then. Reading one script property costs almost nothing.
// The one-minute clock: each tournament in turn (a sleeping one costs one property read).
function tick() {
  slots_().forEach((sl) => { try { withSlot_(sl, tickOne_); } catch (e) { try { withSlot_(sl, () => log_('system', 'ERROR (clock)', String(e && e.stack || e))); } catch (x) { } } });
  const vsp = PropertiesService['getScriptProperties']();
  try { const why = vaultTick_(false); if (why) vsp.setProperty('VAULT_LAST_ERR', why); else vsp.deleteProperty('VAULT_LAST_ERR'); }
  catch (e) { vsp.setProperty('VAULT_LAST_ERR', 'Error: ' + String(e && e.stack || e).slice(0, 400)); vsp.setProperty('VAULT_NEXT', String(Date.now() + 10 * 60000)); }
}
function tickOne_() {
  const pr = props_();
  const nextAt = Number(pr.getProperty('NEXT_AT') || 0), retries = pr.getProperty('RETRY_POSTS');
  if (Date.now() < nextAt && (!retries || retries === '[]')) return;
  const lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return;
  try {
    CFG_CACHE = null;
    try { flushRetries_(); } catch (e) { log_('system', 'ERROR (retries)', String(e && e.stack || e)); }
    const C = cfg_(), t = Date.now();
    let T = stateGet_();
    if (!T && isScr_(C)) ensurePartnerItem_(C);
    // The ✅ health check runs by itself once per tournament, 6 hours before sign-ups close.
    const hk = slugOf_(C), hclose = when_(C.SIGNUP_CLOSE, C);
    if ((!T || !T.done) && hclose && t >= hclose - 6 * 3600e3 && pr.getProperty('HEALTH_RAN') !== hk) { pr.setProperty('HEALTH_RAN', hk); try { autoHealth_(C); } catch (e) { log_('system', 'ERROR (health)', String(e && e.stack || e)); } }
    if (!T) {
      const close = when_(C.SIGNUP_CLOSE, C);
      if (close && t >= close) drawBracket_();
      try { flushLog_(); } catch (e) { }
      T = stateGet_();
      // Sign-ups snapshot themselves as they come in; nothing else happens until sign-ups close.
      if (!T) { pr.setProperty('NEXT_AT', String(close && t < close ? Math.min(close, t + 30 * 60000) : t + 5 * 60000)); return; }
    }
    if (T.done) { try { flushLog_(); } catch (e) { } pr.setProperty('NEXT_AT', String(t + 6 * 3600e3)); return; }
    let changed = false;
    try { changed = detect_(T, C) || changed; } catch (e) { log_('system', 'ERROR (detect)', String(e && e.stack || e)); }
    changed = postDue_(T, C) || changed;
    changed = deadlines_(T, C) || changed;
    changed = waves_(T, C) || changed;
    if (!T.done && champion_(T)) { crown_(T, C); changed = true; }
    if (changed) stateSet_(T);
    if (changed || !pr.getProperty('NEXT_AT')) snapshot_(T);
    try { flushLog_(); } catch (e) { }
    pr.setProperty('NEXT_AT', String(nextWork_(T, C)));
  } finally { lock.releaseLock(); }
}
// When the clock next has something to do: a wave starting, a result airing, a deadline, or (while a match
// is open with no game found yet) a look at SmallBall every 2 minutes.
function nextWork_(T, C) {
  const t = Date.now(), soon = [t + 30 * 60000];
  if (T.done) return t + 6 * 3600e3;
  const start = when_(C.START, C); if (start > t) soon.push(start);
  for (const m of T.matches) {
    if (m.winner || m.void) continue;
    if (m.pend) soon.push(m.pend.airs);
    else if (m.openAt && !m.flag) { soon.push(t + 2 * 60000); soon.push(m.deadline); }
  }
  return Math.max(t + 50000, Math.min.apply(null, soon.filter((x) => x > t - 1)));
}
// Anything that changes the tournament from outside the clock wakes it on its next minute.
function wake_() { try { props_().deleteProperty('NEXT_AT'); } catch (e) { } }
function waveStart_(C, w) { return when_(C.START, C) + (w - 1) * waveMs_(C); }
function waveMs_(C) { return Math.max(15, Number(C.WAVE_MINUTES) || 60) * 60000; }
function currentWave_(C, t) { const s = when_(C.START, C); return t < s ? 0 : Math.floor((t - s) / waveMs_(C)) + 1; }

function drawBracket_() {
  const C = cfg_(), E = entrants_().rows.filter((r) => r.Status !== 'Withdrawn' && norm_(r.ClubID));
  if (isScr_(C)) {
    const T = drawScramble_(C, E); if (!T) return;
    stateSet_(T);
    const et = entrants_(); et.rows.forEach((r) => { const id = Number(r.ClubID), s = T.seeds.find((x) => teamOf_(T, x.club).clubs.indexOf(id) >= 0);
      if (s) { r.Seed = s.seed; writeRow_(et, r); } else if (id === T.alt) { r.Status = 'Alternate'; writeRow_(et, r); } });
    try { if (norm_(C.FORM_ID)) FormApp.openById(norm_(C.FORM_ID)).setAcceptingResponses(false).setCustomClosedFormMessage('Sign-ups are closed. Follow the scramble in Discord!'); } catch (e) { }
    log_('system', 'Teams drawn', T.seeds.length + ' teams');
    scrDrawPost_(T, C);
    return;
  }
  if (E.length < 2) {
    if (!props_().getProperty('TOO_FEW_POSTED')) {
      props_().setProperty('TOO_FEW_POSTED', '1');
      post_('😬 Only ' + E.length + ' club' + (E.length === 1 ? '' : 's') + ' signed up for the **' + esc_(C.TOURNEY_NAME) + '**, so there\'s no bracket yet. Sign-ups stay open: as soon as a second club joins, the bracket is drawn.' + linksLine_(C));
    }
    return;
  }
  const T = createTournament_(E, C);
  stateSet_(T);
  const et = entrants_(); et.rows.forEach((r) => { const s = T.seeds.find((x) => x.club === Number(r.ClubID)); if (s) { r.Seed = s.seed; writeRow_(et, r); } });
  try { if (norm_(C.FORM_ID)) FormApp.openById(norm_(C.FORM_ID)).setAcceptingResponses(false).setCustomClosedFormMessage('Sign-ups are closed. Follow the bracket in Discord!'); } catch (e) { }
  log_('system', 'Bracket drawn', T.seeds.length + ' clubs · ' + T.fmt);
  post_(drawnText_(T, C, entrantMap_()));
}
function drawnText_(T, C, Em) {
  const start = when_(C.START, C);
  const firsts = T.matches.filter((m) => !m.winner && !m.void && sideClub_(T, m.a) > 0 && sideClub_(T, m.b) > 0);
  return ('# 🏆 The ' + esc_(C.TOURNEY_NAME) + ' bracket is set!\n' +
    '**' + T.seeds.length + ' clubs · ' + (T.fmt === 'double' ? 'double elimination (two losses and you\'re out)' : 'single elimination') + ' · BigLeague games only**\n\n' +
    '**Seeds**\n' + T.seeds.map((s) => s.seed + '. ' + tag_(Em[s.club]) + ' · ' + clubTxt_(Em[s.club])).join('\n') + '\n\n' +
    '**How it works**\n> Wave 1 starts ' + ts_(start) + ' (' + tsR_(start) + '). After that, **your next match opens the moment both clubs are known**, and you have ' + Math.round(waveMs_(C) / 60000) + ' minutes to play it.\n' +
    '> When your match opens you\'ll be tagged here. The **lower seed starts a BigLeague game** against the other club (the ping has a one-click link). Nothing for the higher seed to accept. Play early in your window: the sooner your result airs, the sooner your next match opens.\n' +
    '> The script finds the game on SmallBall by itself. Results post once the game has aired: **no spoilers**.\n' +
    '> No game in time: ' + (lc_(C.NO_SHOW) === 'commish' ? 'the organizer decides.' : 'the higher seed moves on.') + ' A tie: ' + (lc_(C.TIE_RULE) === 'higher seed' ? 'the higher seed moves on.' : 'play it again.') + '\n\n' +
    '**Wave 1** (' + firsts.length + ' match' + (firsts.length === 1 ? '' : 'es') + '):\n' + firsts.map((m) => '• ' + nameOf_(Em, T, sideClub_(T, m.a)) + ' vs ' + nameOf_(Em, T, sideClub_(T, m.b))).join('\n') +
    (T.matches.some((m) => m.bye && m.bracket === 'W' && m.round === 1) ? '\n-# Top seeds with a bye wait for the next wave.' : '') + linksLine_(C));
}

// Open matches as soon as they're ready. Wave 1 opens every first-round match at START; after that, a match
// opens the moment both clubs are known from results already posted (so nobody learns a result early), and
// gets its own window (WAVE_MINUTES) from that moment.
function waves_(T, C) {
  const t = Date.now(), start = when_(C.START, C);
  if (!start || t < start) return false;
  const win = waveMs_(C), E = entrantMap_(), opened = [], first = !(T.wave > 0);
  for (const m of T.matches) {
    if (m.winner || m.void || m.openAt) continue;
    const a = sideClub_(T, m.a), b = sideClub_(T, m.b);
    if (!(a > 0 && b > 0)) continue;
    m.openAt = first && t - start < 10 * 60000 ? start : t;
    m.deadline = Math.max(m.openAt + win, t + win * 0.75);   // opened late (a slow trigger)? still a fair window
    opened.push(m);
  }
  if (!opened.length) return false;
  T.wave = (T.wave || 0) + 1; opened.forEach((m) => { m.wave = T.wave; });
  const line = (m) => {
    const a = sideClub_(T, m.a), b = sideClub_(T, m.b);
    // The lower seed needs the game (a no-show sends the higher seed on), so the lower seed starts it.
    const ch = seedOf_(T, a) > seedOf_(T, b) ? a : b, df = ch === a ? b : a;
    return '**' + esc_(m.label) + '** · play by ' + ts_(m.deadline) + ' (' + tsR_(m.deadline) + ')\n> 🥊 ' + nameOf_(E, T, ch) + ' **starts the game** vs club ID `' + df + '`\n> 🛡️ ' + nameOf_(E, T, df) + ' defends · club ID `' + ch + '`' +
      '\n> 👉 [Start the game in SmallBall](<https://play.smallball.com/?sbx_as=' + ch + '#/team/' + df + '>) · check YOUR CLUB is `' + ch + '`, then **Play** (not Exhibition)';
  };
  const head = first ? '## 🔔 Wave 1 is on! First pitch for the ' + esc_(C.TOURNEY_NAME) + '\n'
    : '## 🔔 ' + (opened.length === 1 ? 'Next match is ready' : opened.length + ' matches are ready') + '\n';
  if (T.fmt === 'scramble') post_((first ? '## ⛳ First tee time! The ' + esc_(C.TOURNEY_NAME) + ' is on\n' : '## ⛳ ' + (opened.length === 1 ? 'Next match is on the tee' : opened.length + ' matches are on the tee') + '\n') +
    opened.map((m) => scrLine_(T, m, E)).join('\n\n') + '\n-# Each link opens the other club with YOUR club picked: check it, then **Play** (not Exhibition). All four games inside ' + Math.round(win / 60000) + ' minutes. The script finds them on SmallBall.' + linksLine_(C));
  else post_(head + opened.map(line).join('\n') +
    '\n-# 🥊 The lower seed starts a BigLeague game with the link (check YOUR CLUB first). You have ' + Math.round(win / 60000) + ' minutes. The script finds the game on SmallBall.' + linksLine_(C));
  log_('system', first ? 'Wave 1' : 'Opened', opened.map((m) => m.id).join(', '));
  return true;
}

// Find each open match's game on SmallBall. The result is held until the game has aired.
function detect_(T, C) {
  if (T.fmt === 'scramble') return scrDetect_(T, C);
  const open = T.matches.filter((m) => m.openAt && !m.winner && !m.void && !m.pend && !m.flag);
  if (!open.length) return false;
  const kinds = norm_(C.ALLOWED_KINDS || 'big').split(',').map(lc_).filter(String), E = entrantMap_();
  let changed = false;
  for (const m of open) {
    const a = sideClub_(T, m.a), b = sideClub_(T, m.b);
    let rows; try { rows = clubGames_(a); } catch (e) { log_('system', 'SmallBall error', String(e.message || e)); continue; }
    const used = [].concat.apply([], T.matches.map((x) => x.used || []));   // a game counts for one match only
    const hits = rows.filter((g) => {
      const ft = Date.parse(g.finished_at), ids = [String(g.away_team_id), String(g.home_team_id)];
      return ids.indexOf(String(a)) >= 0 && ids.indexOf(String(b)) >= 0 && kinds.indexOf(lc_(g.kind)) >= 0 &&
        ft >= m.openAt - 120000 && ft <= m.deadline && used.indexOf(String(g.game_id)) < 0 && g.away_runs != null && g.home_runs != null;
    }).sort((x, y) => Date.parse(x.finished_at) - Date.parse(y.finished_at));
    if (!hits.length) continue;
    const g = hits[0], aAway = String(g.away_team_id) === String(a);
    const ra = Number(aAway ? g.away_runs : g.home_runs), rb = Number(aAway ? g.home_runs : g.away_runs);
    const airs = Date.parse(g.finished_at) + Math.max(0, Number(C.POST_DELAY_MINUTES) || 0) * 60000;
    m.pend = { gid: String(g.game_id), ra, rb, airs };
    m.used = (m.used || []).concat(String(g.game_id));   // this match's own games (the global list is built fresh each time)
    log_('system', 'Game found', m.id + ' game ' + g.game_id);
    post_('📡 **Game found** for ' + esc_(m.label) + ': ' + esc_(plainName_(E, a)) + ' vs ' + esc_(plainName_(E, b)) + ' · game `' + g.game_id + '`. The result posts ' + ts_(airs) + ', once it has aired. (No score here: no spoilers.)\n📺 Watch it live: <' + watchUrl_(g.game_id) + '>');
    changed = true;
  }
  return changed;
}

// Results whose game has aired: post them and move the bracket on.
function postDue_(T, C) {
  if (T.fmt === 'scramble') return scrPostDue_(T, C, false);
  const t = Date.now(), E = entrantMap_();
  let changed = false;
  for (const m of T.matches) {
    if (!m.pend || m.pend.airs > t || m.winner) continue;
    const a = sideClub_(T, m.a), b = sideClub_(T, m.b), p = m.pend;
    if (p.ra === p.rb) {
      m.pend = null;
      if (lc_(C.TIE_RULE) === 'higher seed') { finish_(T, m, seedOf_(T, a) < seedOf_(T, b) ? a : b, p, 'tie'); post_(resultText_(T, m, E, C, '🤝 A ' + p.ra + '–' + p.rb + ' tie, so the higher seed moves on.')); }
      else {
        m.deadline = Math.max(m.deadline, t + 30 * 60000);
        post_('🤝 **' + esc_(m.label) + '** ended in a **' + p.ra + '–' + p.rb + ' tie** (game `' + p.gid + '`). Play it again: ' + nameOf_(E, T, a) + ' vs ' + nameOf_(E, T, b) + '. New deadline ' + ts_(m.deadline) + '.' + linksLine_(C));
      }
      changed = true; continue;
    }
    finish_(T, m, p.ra > p.rb ? a : b, p, '');
    post_(resultText_(T, m, E, C, ''));
    changed = true;
  }
  return changed;
}
function finish_(T, m, winner, p, how) {
  const a = sideClub_(T, m.a), b = sideClub_(T, m.b);
  m.winner = winner; m.loser = winner === a ? b : a; m.how = how || '';
  if (p) { m.gid = p.gid; m.score = winner === a ? [p.ra, p.rb] : [p.rb, p.ra]; }
  m.pend = null; m.doneAt = Date.now();
  settle_(T);
  log_('system', 'Result', m.id + ': ' + winner + ' over ' + m.loser + (m.score ? ' ' + m.score.join('-') : '') + (how ? ' (' + how + ')' : ''));
}
function lossesOf_(T, club) { return T.matches.filter((m) => m.loser === club && !m.bye).length; }
function resultText_(T, m, E, C, note) {
  if (T.fmt === 'scramble') return scrResultText_(T, m, E, C, note);
  const w = m.winner, l = m.loser, out = T.fmt === 'double' ? lossesOf_(T, l) >= 2 || m.id === 'GF2' || (m.id === 'GF' && T.matches.find((x) => x.id === 'GF2' && x.void)) : true;
  let s = '🏆 **' + esc_(m.label) + '**: ' + nameOf_(E, T, w) + ' beats ' + nameOf_(E, T, l) + (m.score ? ' **' + m.score[0] + '–' + m.score[1] + '**' : '') + (m.gid ? ' · game `' + m.gid + '`' : '') + '.';
  if (note) s += '\n' + note;
  if (m.id === 'GF' && T.matches.find((x) => x.id === 'GF2' && !x.void && !x.winner)) s += '\n🔥 The losers-bracket champ wins the first grand final! **Bracket reset:** one more game decides it all.';
  else if (out && !champion_(T)) s += '\n💀 ' + esc_(plainName_(E, l)) + ' is out.' ;
  else if (!out && T.fmt === 'double') s += '\n⬇️ ' + esc_(plainName_(E, l)) + ' drops to the losers bracket.';
  const next = T.matches.find((x) => !x.winner && !x.void && (sideClub_(T, x.a) === w || sideClub_(T, x.b) === w));
  if (next && !champion_(T)) s += '\n➡️ ' + esc_(plainName_(E, w)) + ' plays next in the **' + esc_(next.label) + '**, which opens at the next wave.';
  return s + linksLine_(C);
}

// The end of a wave: no game, no result.
function deadlines_(T, C) {
  if (T.fmt === 'scramble') return scrPostDue_(T, C, true);
  const t = Date.now(), E = entrantMap_();
  let changed = false;
  for (const m of T.matches) {
    if (!m.openAt || m.winner || m.void || m.pend || m.flag || t < m.deadline) continue;
    const a = sideClub_(T, m.a), b = sideClub_(T, m.b);
    if (lc_(C.NO_SHOW) === 'commish') {
      m.flag = true; changed = true;
      post_('⏰ **' + esc_(m.label) + '**: no game between ' + esc_(plainName_(E, a)) + ' and ' + esc_(plainName_(E, b)) + ' this wave. The organizer will decide.');
      log_('system', 'No-show (commish)', m.id);
      continue;
    }
    const w = seedOf_(T, a) < seedOf_(T, b) ? a : b;
    finish_(T, m, w, null, 'no-show');
    post_(resultText_(T, m, E, C, '⏰ No game was played before the deadline, so the higher seed moves on.'));
    changed = true;
  }
  return changed;
}
function crown_(T, C) {
  if (T.fmt === 'scramble') return scrCrown_(T, C);
  const E = entrantMap_(), c = champion_(T); T.done = Date.now();
  const runner = (() => { const f = T.matches.filter((m) => m.bracket === 'F' || m.id === T.final).filter((m) => m.winner && !m.void).pop(); return f ? f.loser : null; })();
  const lossless = lossesOf_(T, c) === 0; T.runner = runner || null;
  post_('# 👑 ' + esc_(plainName_(E, c)) + ' wins the ' + esc_(C.TOURNEY_NAME) + '!\n' +
    tag_(E[c]) + ' (#' + seedOf_(T, c) + ' seed) takes it' + (lossless ? ' without a single loss' : ' the hard way, out of the losers bracket') + '. 🎉' +
    (runner ? '\n🥈 Runner-up: ' + tag_(E[runner]) + ' (*' + esc_(plainName_(E, runner)) + '*)' : '') +
    (norm_(C.PRIZES) ? '\n🎁 Prizes: ' + esc_(C.PRIZES) : '') + '\nThanks for playing, everybody! 🐶' + linksLine_(C));
  log_('system', 'Champion', String(c));
}

// ===================== The live bracket: a snapshot the web page reads =====================
function snapshot_(T) {
  T = T || stateGet_();
  const C = cfg_(), E = entrantMap_(), et = entrants_().rows.filter((r) => r.Status !== 'Withdrawn');
  const club = (id) => { if (!(id > 0)) return null; const e = E[id];
    if (e && e.team) return { id, n: 'Team ' + norm_(e.Discord), s: seedOf_(T, id), how: e.team.how, clubs: e.team.clubs.map((c) => ({ id: c, n: E[c] ? norm_(E[c].Club) : 'Club ' + c, o: E[c] ? norm_(E[c].Discord) : '' })) };
    return e ? { id, n: norm_(e.Club), o: norm_(e.Discord), s: T ? seedOf_(T, id) : 0, st: norm_(e.Stars) } : { id, n: 'Club ' + id }; };
  const snap = {
    name: norm_(C.TOURNEY_NAME), updated: Date.now(), prizes: norm_(C.PRIZES), form: norm_(C.FORM_LINK), perOwner: Math.max(1, Number(C.MAX_PER_OWNER) || 1),
    signupClose: when_(C.SIGNUP_CLOSE, C), start: when_(C.START, C), waveMin: Math.round(waveMs_(C) / 60000), tz: tz_(C),
    entrants: et.map((r) => ({ n: norm_(r.Club), o: norm_(r.Discord), id: Number(r.ClubID), st: norm_(r.Stars), p: norm_(r.Partner) })),
  };
  if (!T && isScr_(C)) { /* a scramble's teams aren't known until sign-ups close: the page shows the tee sheet */ }
  else if (!T) {
    // The bracket we're aiming for: today's sign-ups in seed order, the rest "open spots". Placeholders are -1000-k.
    const ord = seededEntrants_(et, C), size = Math.max(Number(C.PREVIEW_SIZE) || 16, pow2_(ord.length));
    const ids = ord.map((r) => Number(r.ClubID)); for (let k = ids.length; k < size; k++) ids.push(-1000 - k);
    const P = lc_(C.FORMAT) === 'single' ? buildSingle_(ids, {}) : buildDouble_(ids, lc_(C.GRAND_FINAL_RESET) !== 'no');
    const Tp = { seeds: ids.map((c, i) => ({ club: c, seed: i + 1 })), matches: P.matches };
    const pc = (id) => id == null ? null : id <= -1000 ? { id, n: 'Open spot', s: -999 - id, open: true } : (() => { const e = E[id]; return e ? { id, n: norm_(e.Club), o: norm_(e.Discord), s: seedOf_(Tp, id), st: norm_(e.Stars) } : null; })();
    // Put the live bracket's link on the sign-up form once the web app is deployed.
    try { const url = boardUrl_(C), pr = props_();
      if (url && norm_(C.FORM_ID) && pr.getProperty('FORM_LINKED') !== url) { FormApp.openById(norm_(C.FORM_ID)).setDescription(FORM_DESC + '\n\n📋 The bracket preview and who\'s in: ' + url); pr.setProperty('FORM_LINKED', url); } } catch (e) { }
    snap.preview = { size, filled: ord.length, fmt: lc_(C.FORMAT) === 'single' ? 'single' : 'double', seeding: lc_(C.SEEDING) || 'signup',
      matches: P.matches.map((m) => ({ id: m.id, b: m.bracket, r: m.round, l: m.label, a: pc(sideClub_(Tp, m.a)), z: pc(sideClub_(Tp, m.b)), v: false })) };
  }
  if (T) {
    snap.fmt = T.fmt; snap.wave = T.wave || 0; snap.done = !!T.done; snap.champ = T.done ? club(champion_(T)) : null; snap.runner = T.done && T.runner ? club(T.runner) : null;
    snap.seeds = T.seeds.map((s) => club(s.club));
    // Only what Discord has been told: a match's winner shows once its result posted; a pending game shows as "game found".
    snap.matches = T.matches.map((m) => ({ id: m.id, b: m.bracket, r: m.round, l: m.label, a: club(sideClub_(T, m.a)), z: club(sideClub_(T, m.b)),
      byeA: sideClub_(T, m.a) === BYE, byeZ: sideClub_(T, m.b) === BYE, w: m.winner > 0 ? m.winner : null, sc: m.score || null, how: m.how || '', bye: !!m.bye, v: !!m.void,
      open: !!m.openAt && !m.winner && !m.void, dl: m.deadline || 0, g: m.pend ? m.pend.gid : (m.gid || ''), live: !!m.pend, flag: !!m.flag,
      nas: m.winner && m.nassau ? m.nassau : null, mp: m.winner && m.mp ? { a: m.mp.a, b: m.mp.b, run: m.mp.run, res: m.mp.res, clinch: m.mp.clinch, ca: m.mp.ca, cb: m.mp.cb } : null, found: (m.games || []).filter((g) => g.gid).length,
      games: m.games && !m.winner ? m.games.map((g) => ({ nine: g.nine, an: plainName_(E, g.a), bn: plainName_(E, g.b), teen: E[g.tee] ? norm_(E[g.tee].Discord) : '', g: g.gid || '', aired: !!(g.gid && g.airs <= Date.now()) })) : null }));
    if (T.fmt === 'scramble') { snap.fmt = 'scramble'; snap.alt = T.alt && E[T.alt] ? { n: norm_(E[T.alt].Club), o: norm_(E[T.alt].Discord) } : null; }
  }
  sheet_(SHEETS.BOARD).getRange(1, 1).setValue(JSON.stringify(snap));
  ghPush_(snap);
  try { updateIndex_(snap); } catch (e) { log_('system', 'Tournaments page not updated', String(e.message || e)); }
  // A readable Matches tab for the organizer.
  if (T) {
    const sh = sheet_(SHEETS.MATCHES, ['ID', 'Match', 'Club A', 'Club B', 'Status', 'Winner', 'Score', 'Game', 'Opens', 'Deadline']);
    const rows = T.matches.filter((m) => !m.void).map((m) => { const a = sideClub_(T, m.a), b = sideClub_(T, m.b);
      return [m.id, m.label, a > 0 ? plainName_(E, a) : a === BYE ? 'bye' : 'TBD', b > 0 ? plainName_(E, b) : b === BYE ? 'bye' : 'TBD',
        m.winner ? (m.bye ? 'Bye' : m.how ? 'Done (' + m.how + ')' : 'Done') : m.flag ? 'Needs the organizer' : m.pend ? 'Game found, airing' : m.openAt ? 'Open' : 'Waiting',
        m.winner > 0 ? plainName_(E, m.winner) : '', m.score ? m.score.join('-') : '', m.pend ? m.pend.gid : m.gid || '', m.openAt ? new Date(m.openAt) : '', m.deadline ? new Date(m.deadline) : '']; });
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 10).clearContent();
    if (rows.length) sh.getRange(2, 1, rows.length, 10).setValues(rows);
  }
}


// ===================== The bracket on GitHub Pages =====================
// The token lives in Script Properties (never on a tab). Each change to the bracket is saved as one small JSON
// file in the repo; the page next to it reads that file. Nothing is sent when the bracket hasn't changed.
function ghPush_(snap, force) {
  const C = cfg_(), key = JSON.stringify(Object.assign({}, snap, { updated: 0 }));
  return ghPut_(norm_(C.GITHUB_PATH) || 'docs/brawl/bracket.json', JSON.stringify(snap), 'Bracket update: ' + (snap.name || 'tournament'), key, force);
}
// One file in the repo, saved only when it changed. hashSrc = what counts as "changed" (default: the text itself).
function ghPut_(path, body, message, hashSrc, force) {
  const pr = props_(), tok = pr.getProperty('GITHUB_TOKEN');
  if (!tok || pr.getProperty('GH_BAD')) return false;   // a dead key stays quiet until it's reconnected
  const C = cfg_(), repo = norm_(C.GITHUB_REPO) || 'slipnsliders/smallball-tools';
  const hk = path === (norm_(C.GITHUB_PATH) || 'docs/brawl/bracket.json') ? 'GH_HASH' : 'GH_HASH:' + path;
  const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, (hashSrc == null ? body : hashSrc) + repo + path, Utilities.Charset.UTF_8));
  if (!force && pr.getProperty(hk) === hash) return true;
  const api = ghApi_(repo, path), headers = ghHeaders_(tok);
  for (let attempt = 0; attempt < 2; attempt++) {
    let sha = null;
    const g = UrlFetchApp.fetch(api, { headers, muteHttpExceptions: true });
    if (g.getResponseCode() === 200) try { sha = JSON.parse(g.getContentText()).sha; } catch (e) { }
    else if (g.getResponseCode() === 401 || g.getResponseCode() === 403) { pr.setProperty('GH_BAD', '1'); log_('system', 'GitHub key stopped working', 'GitHub said ' + g.getResponseCode() + '. The live page is paused: make a key (or reuse your current one) and use the menu: 🐙 Connect again.'); return false; }
    else if (g.getResponseCode() !== 404) { log_('system', 'GitHub read failed', g.getResponseCode() + ' ' + g.getContentText().slice(0, 200)); return false; }
    const payload = { message, content: Utilities.base64Encode(body, Utilities.Charset.UTF_8) };
    if (sha) payload.sha = sha;
    const r = UrlFetchApp.fetch(api, { method: 'put', headers, contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
    const code = r.getResponseCode();
    if (code === 200 || code === 201) { pr.setProperty(hk, hash); return true; }
    if (code !== 409 && code !== 422) { log_('system', 'GitHub save failed', code + ' ' + r.getContentText().slice(0, 200)); return false; }
  }
  return false;
}
const ghApi_ = (repo, path) => 'https://api.github.com/repos/' + repo + '/contents/' + path.split('/').map(encodeURIComponent).join('/');
const ghHeaders_ = (tok) => ({ Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
// Read a text file from the repo (null if it isn't there or GitHub isn't connected).
function ghGet_(path) {
  const pr = props_(), tok = pr.getProperty('GITHUB_TOKEN');
  if (!tok || pr.getProperty('GH_BAD')) return null;
  const C = cfg_(), r = UrlFetchApp.fetch(ghApi_(norm_(C.GITHUB_REPO) || 'slipnsliders/smallball-tools', path), { headers: Object.assign(ghHeaders_(tok), { Accept: 'application/vnd.github.raw+json' }), muteHttpExceptions: true });
  return r.getResponseCode() === 200 ? r.getContentText() : null;
}
function ghPageUrl_(C) {
  const repo = (norm_(C.GITHUB_REPO) || 'slipnsliders/smallball-tools').split('/'), path = norm_(C.GITHUB_PATH) || 'docs/brawl/bracket.json';
  const dir = path.replace(/^docs\//, '').replace(/[^/]*$/, '');
  return 'https://' + repo[0].toLowerCase() + '.github.io/' + repo[1] + '/' + dir;
}
function adminConnectGithub() {
  withUi_((ui) => {
    const r = ui.prompt('Connect the GitHub bracket page',
      'Paste a GitHub fine-grained token with "Contents: Read and write" on ' + (norm_(cfg_().GITHUB_REPO) || 'slipnsliders/smallball-tools') + ' only.\n' +
      'It is kept in the script\'s private settings, not on any tab. Leave it blank and click OK to disconnect.', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return '';
    const pr = props_(), tok = norm_(r.getResponseText());
    if (!tok) { pr.deleteProperty('GITHUB_TOKEN'); pr.deleteProperty('GH_HASH'); pr.deleteProperty('GH_BAD'); return 'GitHub disconnected.'; }
    pr.setProperty('GITHUB_TOKEN', tok); pr.deleteProperty('GH_HASH'); pr.deleteProperty('GH_BAD');
    const C = cfg_(), url = ghPageUrl_(C);
    snapshot_(stateGet_());
    if (!pr.getProperty('GH_HASH')) return 'GitHub didn\'t accept that token. Check it has Contents: Read and write on the repo, then try again (the Log tab has the details).';
    setCfg_('BOARD_LINK', url);
    snapshot_(stateGet_());   // so the form's description picks up the new link
    return 'Connected! The live bracket is at ' + url + ' (give GitHub a minute the first time). Discord posts now link there.';
  });
}

// ===================== Web page =====================
function doGet(e) {
  const t = e && e.parameter && e.parameter.t;
  if (t && slots_().indexOf(String(t)) > 0) return withSlot_(String(t), () => doGetOne_(e));
  return doGetOne_(e);
}
function doGetOne_(e) {
  const demo = e && e.parameter && e.parameter.demo;
  let snap = demo ? demoSnap_() : null;
  if (!snap) { const v = sheet_(SHEETS.BOARD).getRange(1, 1).getValue(); try { snap = JSON.parse(v || '{}'); } catch (x) { snap = {}; } }
  const safe = JSON.stringify(snap).replace(/</g, '\\u003c');
  const html = (isScr_(cfg_()) ? GOLF_HTML_ : BRACKET_HTML_).replace('__DATA__', function () { return safe; });   // a function, so "$" in names stays as is
  return HtmlService.createHtmlOutput(html).setTitle((snap.name || 'SmallBall Tournament') + ' · bracket')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ===================== Organizer menu =====================
function onOpen() {
  let now = ''; try { now = withSlot_(adminSlot_(), () => norm_(cfg_().TOURNEY_NAME)); } catch (e) { }
  const many = slots_().length > 1;
  SpreadsheetApp.getUi().createMenu('🏆 Tournament')
    .addItem(many ? '🔀 Working on: ' + now + ' (switch)' : '🔀 Working on: ' + now, 'adminSwitch')
    .addItem('🆕 New tournament…', 'adminNewTournament')
    .addItem('✅ Health check', 'adminHealth')
    .addSeparator()
    .addItem('Set up / repair (form, tabs, triggers)', 'setup')
    .addItem('🔄 Check SmallBall now', 'adminCheckNow')
    .addItem('✅ Settle a match by hand', 'adminSettle')
    .addItem('↩️ Undo a match result', 'adminUndo')
    .addItem('📣 Post the sign-up announcement', 'adminAnnounce')
    .addItem('🗂️ Post the bracket to Discord', 'adminPostBracket')
    .addItem('🎲 Draw the bracket now (close sign-ups early)', 'adminDrawNow')
    .addItem('🧪 Test the Discord webhook', 'adminTestWebhook')
    .addItem('🧪 Mock tournament (test posts in Discord)', 'adminMockTournament')
    .addItem('🗑️ Delete the mock test posts', 'adminDeleteMockPosts')
    .addItem('🏦 Update the Prize Vault now', 'adminVaultNow')
    .addItem('👥 Allow two clubs per owner', 'adminTwoPerOwner')
    .addItem('🐙 Connect the GitHub bracket page', 'adminConnectGithub')
    .addItem('🔑 Connect SmallBall box scores (Scramble)', 'adminConnectSmallBall')
    .addItem('🧪 Practice round (Scramble box-score test)', 'adminPracticeRound')
    .addSeparator()
    .addItem('🆕 New tournament (question boxes)', 'adminNewTournamentBoxes')
    .addItem('🧹 Start over (clear the bracket, keep sign-ups)', 'adminResetBracket')
    .addToUi();
}
// Menu items act on the tournament you're working on (🔀 to switch).
function withUi_(fn) {
  const ui = SpreadsheetApp.getUi();
  withSlot_(adminSlot_(), () => { try { const msg = fn(ui); if (msg) ui.alert(msg); } catch (e) { if (!(e && e.cancel)) ui.alert('Problem: ' + (e.message || e)); } });
}
function setup() {
  const ss = ss_(); props_().setProperty('SHEET_ID', ss.getId());
  slots_().forEach((sl) => withSlot_(sl, setupOne_));
  installTriggers_();
  const C = withSlot_(adminSlot_(), cfg_);
  try { SpreadsheetApp.getUi().alert('Set up ✅\n\nSign-up form for the ' + norm_(C.TOURNEY_NAME) + ': ' + norm_(C.FORM_LINK) + (slots_().length > 1 ? '\n\n' + slots_().length + ' tournaments in this Sheet, all checked.' : '') + '\n\nNext: run ✅ Health check.'); } catch (e) { }
}
// Tabs, settings and the sign-up form for one tournament.
function setupOne_() {
  const sh = sheet_(SHEETS.CONFIG, ['Key', 'Value', 'Notes']), have = {};
  sh.getRange('B:B').setNumberFormat('@');   // keep times as typed (before writing them)
  sh.getDataRange().getValues().slice(1).forEach((r) => { have[norm_(r[0])] = true; });
  Object.keys(DEFAULTS).forEach((k) => { if (!have[k]) sh.appendRow([k, DEFAULTS[k][0], DEFAULTS[k][1]]); });
  sheet_(SHEETS.ENTRANTS, ENTRANT_COLS).getRange('C:C').setNumberFormat('@');
  [SHEETS.MATCHES, SHEETS.LOG, SHEETS.STATE, SHEETS.BOARD].forEach((n) => sheet_(n, n === SHEETS.LOG ? ['Time', 'Actor', 'Action', 'Details'] : null));
  sheet_(SHEETS.ROSTER, ROSTER_COLS).getRange('C:C').setNumberFormat('@');
  CFG_CACHE = null; const C = cfg_();
  let form = null;
  try { if (norm_(C.FORM_ID)) form = FormApp.openById(norm_(C.FORM_ID)); } catch (e) { form = null; }
  if (!form) {
    form = makeForm_(norm_(C.TOURNEY_NAME));
    setCfg_('FORM_ID', form.getId());
    if (!norm_(C.FORM_LINK)) setCfg_('FORM_LINK', form.getPublishedUrl());
  }
  // Returning players: every box optional (blank = from your record). Also brings an older form up to date.
  try { form.setDescription(FORM_DESC).setCollectEmail(true); form.getItems(FormApp.ItemType.TEXT).forEach((it) => it.asTextItem().setRequired(false)); } catch (e) { }
  wake_();
  log_('organizer', 'Setup', 'Form ' + form.getId());
  snapshot_();
}
function makeForm_(name) {
  const form = FormApp.create(name + ' · sign-up');
  form.setDescription(FORM_DESC)
    .setCollectEmail(true).setAllowResponseEdits(true).setLimitOneResponsePerUser(false)
    .setConfirmationMessage('Got it! Watch the tournament channel in Discord: your sign-up shows there within a minute (or a red ❌ if something needs fixing).');
  form.addTextItem().setTitle(Q.DISCORD);
  form.addTextItem().setTitle(Q.DISCORD_ID).setHelpText('Discord → Settings → Advanced → Developer Mode on, then right-click your name → Copy User ID. A long number. Optional.');
  form.addTextItem().setTitle(Q.OWNER);
  form.addTextItem().setTitle(Q.CLUB);
  form.addTextItem().setTitle(Q.CLUB_ID).setHelpText('The number on your club page.');
  form.addTextItem().setTitle(Q.STARS).setHelpText('Optional, for seeding and the bracket.');
  try { form.setDestination(FormApp.DestinationType.SPREADSHEET, ss_().getId()); } catch (e) { }
  return form;
}
// One clock for every tournament, and one sign-up trigger per form.
function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach((t) => { if (['onTourneyFormSubmit', 'tick'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  slots_().forEach((sl) => withSlot_(sl, () => { const id = norm_(cfg_().FORM_ID);
    if (id) try { ScriptApp.newTrigger('onTourneyFormSubmit').forForm(FormApp.openById(id)).onFormSubmit().create(); } catch (e) { log_('system', 'Form trigger failed', String(e.message || e)); } }));
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
}
function adminCheckNow() { withUi_(() => { wake_(); tick(); const T = stateGet_(); return T ? 'Checked. Wave ' + (T.wave || 0) + (T.done ? ' · finished' : '') + '. See the Matches tab.' : 'Checked. No bracket yet: it\'s drawn when sign-ups close.'; }); }
function adminDrawNow() { withUi_((ui) => { if (stateGet_()) return 'The bracket is already drawn.'; if (ui.alert('Close sign-ups and draw the bracket now?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return ''; drawBracket_(); snapshot_(); return stateGet_() ? 'Bracket drawn and posted.' : 'Not enough clubs yet.'; }); }
function adminPostBracket() { withUi_(() => { const T = stateGet_(); if (!T) return 'No bracket yet.'; post_(bracketText_(T)); return 'Posted.'; }); }
function bracketText_(T) {
  const C = cfg_(), E = entrantMap_(), L = ['🗂️ **' + esc_(C.TOURNEY_NAME) + ' · where it stands**'];
  const sec = (title, list) => { if (!list.length) return; L.push('\n**' + title + '**'); list.forEach((m) => { const a = sideClub_(T, m.a), b = sideClub_(T, m.b);
    L.push((m.winner ? '✅ ' : m.openAt ? '🔴 ' : '▫️ ') + esc_(m.label) + ': ' + (a > 0 ? esc_(plainName_(E, a)) : 'TBD') + ' vs ' + (b > 0 ? esc_(plainName_(E, b)) : 'TBD') + (m.winner > 0 ? ' → **' + esc_(plainName_(E, m.winner)) + '**' + (m.score ? ' ' + m.score.join('–') : '') : '')); }); };
  const real = T.matches.filter((m) => !m.void && !m.bye);
  sec('Winners bracket', real.filter((m) => m.bracket === 'W'));
  sec('Losers bracket', real.filter((m) => m.bracket === 'L'));
  sec('Grand final', real.filter((m) => m.bracket === 'F'));
  return L.join('\n') + linksLine_(C);
}
function adminSettle() {
  withUi_((ui) => {
    const T = stateGet_(); if (!T) return 'No bracket yet.';
    const E = entrantMap_(), open = T.matches.filter((m) => !m.winner && !m.void && sideClub_(T, m.a) > 0 && sideClub_(T, m.b) > 0);
    if (!open.length) return 'No match is waiting for a result.';
    const list = open.map((m) => m.id + ': ' + m.label + ' · ' + plainName_(E, sideClub_(T, m.a)) + ' (' + sideClub_(T, m.a) + ') vs ' + plainName_(E, sideClub_(T, m.b)) + ' (' + sideClub_(T, m.b) + ')').join('\n');
    const r1 = ui.prompt('Settle a match', list + '\n\nType: MATCH-ID WINNER-CLUB-ID [score like 5-3]\ne.g. WR1M2 640335 5-3', ui.ButtonSet.OK_CANCEL);
    if (r1.getSelectedButton() !== ui.Button.OK) return '';
    const parts = norm_(r1.getResponseText()).split(/\s+/), m = open.find((x) => x.id === parts[0]);
    if (!m) return 'No open match ' + parts[0] + '.';
    const w = Number(parts[1]), a = sideClub_(T, m.a), b = sideClub_(T, m.b);
    if (w !== a && w !== b) return 'The winner must be ' + a + ' or ' + b + '.';
    const sc = /^(\d+)-(\d+)$/.exec(parts[2] || ''), p = sc ? { gid: '', ra: w === a ? +sc[1] : +sc[2], rb: w === a ? +sc[2] : +sc[1] } : null;
    m.flag = false; finish_(T, m, w, p, 'organizer');
    post_(resultText_(T, m, E, cfg_(), '🧑‍⚖️ Settled by the organizer.'));
    if (champion_(T) && !T.done) crown_(T, cfg_());
    stateSet_(T); snapshot_(T); wake_(); return 'Settled ' + m.id + '.';
  });
}
function adminUndo() {
  withUi_((ui) => {
    const T = stateGet_(); if (!T) return 'No bracket yet.';
    const E = entrantMap_(), done = T.matches.filter((m) => m.winner > 0 && !m.bye);
    const r1 = ui.prompt('Undo a result', done.map((m) => m.id + ': ' + m.label + ' → ' + plainName_(E, m.winner)).join('\n') + '\n\nType the match ID. Matches that came after it are cleared too.', ui.ButtonSet.OK_CANCEL);
    if (r1.getSelectedButton() !== ui.Button.OK) return '';
    const m = done.find((x) => x.id === norm_(r1.getResponseText())); if (!m) return 'No such finished match.';
    // Clear this match and everything that depends on it.
    const clear = (id) => { T.matches.forEach((x) => { if ((x.a.from === id || x.b.from === id || x.resetOf === id) && (x.winner || x.openAt || x.void || x.pend)) { clear(x.id); } if (x.a.from === id || x.b.from === id || x.resetOf === id) { delete x.winner; delete x.loser; delete x.score; delete x.gid; delete x.how; delete x.bye; delete x.void; delete x.pend; delete x.openAt; delete x.deadline; delete x.flag; delete x.games; delete x.nassau; delete x.mp; } }); };
    clear(m.id); delete m.games; delete m.nassau; delete m.mp; delete m.winner; delete m.loser; delete m.score; delete m.gid; delete m.how; m.pend = null; m.flag = false; delete T.done;
    m.deadline = Math.max(m.deadline || 0, Date.now() + waveMs_(cfg_()));
    settle_(T); stateSet_(T); snapshot_(T); wake_();
    post_('↩️ The organizer reopened **' + esc_(m.label) + '**.' + linksLine_(cfg_()));
    return 'Reopened ' + m.id + '.';
  });
}
function adminTestWebhook() { withUi_(() => { post_('🧪 Test from the **' + esc_(cfg_().TOURNEY_NAME) + '** script: the webhook works!' + linksLine_(cfg_())); return 'Sent. Check Discord.'; }); }
// ===================== 🧪 Mock tournament =====================
// Plays a pretend bracket from sign-up close to champion through the REAL code (bracket, waves, game found,
// results, a tie, a no-show, the crown), posting to this tournament's Discord channel with a 🧪 TEST tag.
// Nothing touches the real bracket, sign-ups, Log or web page, and nobody is pinged (pretend owners).
// Every post's message ID is kept so 🗑️ Delete the mock test posts can remove them all afterwards.
const MOCK_TAG_ = '-# 🧪 TEST · mock tournament, not real results\n';
function mockSend_(url, name, text) {
  const ids = [];
  const chunks = []; let s = text;
  while (s.length > 1850) { const cut = s.lastIndexOf('\n', 1850); const at = cut > 0 ? cut : 1850; chunks.push(s.slice(0, at)); s = s.slice(at); }
  chunks.push(s);
  chunks.forEach((c) => {
    const go = () => UrlFetchApp.fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'wait=true', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ content: MOCK_TAG_ + c, username: '🧪 ' + (norm_(cfg_().TOURNEY_NAME) || 'Tournament') + ' (TEST)', allowed_mentions: { parse: [] } }) });
    let r = go();
    for (let n = 0; r.getResponseCode() === 429 && n < 4; n++) { let w = 2; try { w = Number(JSON.parse(r.getContentText()).retry_after) || 2; } catch (e) { } Utilities.sleep(Math.min(15, w + 0.5) * 1000); r = go(); }
    if (r.getResponseCode() === 200) { try { ids.push(String(JSON.parse(r.getContentText()).id)); } catch (e) { } }
    Utilities.sleep(2100);   // Discord allows about 30 webhook posts a minute per channel
  });
  return ids;
}
function mockIds_() { let x = []; try { x = JSON.parse(props_().getProperty('MOCK_MSGS') || '[]'); } catch (e) { } return x; }
function adminMockTournament() {
  withUi_((ui) => {
    const C0 = cfg_(), url = webhook_(C0);
    if (!url) return 'No Discord webhook in Config for the ' + norm_(C0.TOURNEY_NAME) + '.';
    if (isScr_(C0)) return 'The mock runs bracket tournaments (single or double elimination), not ⛳ Scrambles.';
    const r = ui.prompt('🧪 Mock tournament: ' + norm_(C0.TOURNEY_NAME), 'This plays a pretend tournament start to finish and posts every announcement to this tournament\'s Discord channel (about 30 to 40 posts over 2 or 3 minutes), each tagged 🧪 TEST. Pretend clubs and owners: nobody is pinged, and the real bracket, sign-ups and page aren\'t touched.\n\nHow many pretend clubs? (4 to 8, blank = 6)\n\nAfterwards, 🗑️ Delete the mock test posts removes every one of them.', ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return '';
    const n = Math.max(4, Math.min(8, Number(norm_(r.getResponseText())) || 6));
    const out = mockRun_(n);
    return '🧪 Mock tournament done: ' + out.posts + ' test posts in Discord' + (out.champ ? ', ' + out.champ + ' won' : '') + '.\n' + out.steps.join(' → ') + '\n\nWhen you\'re done looking: 🏆 Tournament → 🗑️ Delete the mock test posts.';
  });
}
function mockRun_(n) {
  const C0 = cfg_(), url = webhook_(C0), G = globalThis, saved = {}, keep = ['post_', 'entrantMap_', 'stateGet_', 'stateSet_', 'clubGames_', 'log_', 'cfg_'];
  keep.forEach((k) => { saved[k] = G[k]; });
  const ids = mockIds_(), steps = [], save = () => props_().setProperty('MOCK_MSGS', JSON.stringify(ids.slice(-400)));
  const names = ['Mock Mudcats', 'Test Tube Titans', 'Dry Run Dingers', 'Sandbox Sluggers', 'Placeholder Pelicans', 'Dummy Data Dodgers', 'Fake Plastic Trees', 'Rehearsal Rattlers'];
  const owners = ['TestOwner Ace', 'TestOwner Ace', 'TestOwner Bo', 'TestOwner Cy', 'TestOwner Cy', 'TestOwner Di', 'TestOwner Ed', 'TestOwner Fi'];
  const rows = names.slice(0, n).map((nm, i) => ({ ClubID: String(990001 + i), Club: '🧪 ' + nm, Discord: owners[i], DiscordID: '', Stars: String(8 - i), Joined: new Date(Date.now() - (n - i) * 3600e3), Status: 'In' }));
  const E = {}; rows.forEach((x) => { E[Number(x.ClubID)] = x; });
  const C = Object.assign({}, C0, { START: new Date(Date.now() - 60000), POST_DELAY_MINUTES: 0 });
  let T = null, gid = 7700000, tieDone = false, noShow = null, posts = 0;
  try {
    G.cfg_ = () => C;
    G.post_ = (text) => { const got = mockSend_(url, '', text); got.forEach((x) => ids.push(x)); posts += got.length; save(); };
    G.entrantMap_ = () => E; G.stateGet_ = () => T; G.stateSet_ = (x) => { T = x; }; G.log_ = () => {};
    // SmallBall's game list, faked: each open match's game is "played" (one tie gets replayed, one match no-shows).
    G.clubGames_ = (club) => {
      const out = [], t = Date.now();
      T.matches.filter((m) => m.openAt && !m.winner && !m.void && !m.pend && m !== noShow).forEach((m) => {
        const a = sideClub_(T, m.a), b = sideClub_(T, m.b); if (a !== Number(club) && b !== Number(club)) return;
        let ra = 1 + Math.floor(Math.random() * 7), rb = 1 + Math.floor(Math.random() * 7); if (ra === rb) rb++;
        if (!tieDone && m.bracket === 'W' && m.round === 2) { tieDone = true; rb = ra; }
        out.push({ game_id: ++gid, away_team_id: a, home_team_id: b, away_runs: ra, home_runs: rb, kind: 'big', finished_at: new Date(t).toISOString() });
      });
      return out;
    };
    G.post_('# 🧪 TEST: mock tournament incoming\nThe ' + esc_(C0.TOURNEY_NAME) + ' script is running a **pretend tournament** to check its announcements. The next few dozen posts are **not real**: pretend clubs, pretend scores, nobody pinged. They\'ll be deleted after the test. Carry on! 🐶');
    T = createTournament_(rows, C); G.post_(drawnText_(T, C, E)); steps.push('bracket (' + T.fmt + ')');
    for (let i = 0; i < 40 && !T.done; i++) {
      if (waves_(T, C)) steps.push('wave ' + T.wave);
      // One match in wave 2 is a no-show: its window runs out with no game.
      if (!noShow) { const m = T.matches.find((x) => x.wave === 2 && !x.winner && !x.pend); if (m) noShow = m; }
      if (noShow && !noShow.winner && noShow.openAt) noShow.deadline = Date.now() - 1000;
      if (detect_(T, C)) steps.push('games found');
      if (postDue_(T, C)) steps.push('results');
      if (deadlines_(T, C)) steps.push('no-show');
      if (noShow && noShow.flag && !noShow.winner) {   // NO_SHOW = commish: play the organizer settling it by hand
        const a = sideClub_(T, noShow.a), b = sideClub_(T, noShow.b); noShow.flag = false;
        finish_(T, noShow, seedOf_(T, a) < seedOf_(T, b) ? a : b, null, 'organizer'); G.post_(resultText_(T, noShow, E, C, '🧑‍⚖️ The organizer moved the higher seed on.'));
      }
      if (!T.done && champion_(T)) { crown_(T, C); steps.push('champion'); }
    }
    G.post_('🧪 **End of the mock tournament.** That was every kind of post the ' + esc_(C0.TOURNEY_NAME) + ' makes: bracket, waves, game found, results, a tie replay, a no-show and the champion. These test posts will be cleaned up shortly.');
    return { posts, steps, champ: T && T.done ? plainName_(E, champion_(T)) : '' };
  } finally { keep.forEach((k) => { G[k] = saved[k]; }); CFG_CACHE = null; save(); }
}
function adminDeleteMockPosts() {
  withUi_((ui) => {
    const ids = mockIds_(), url = webhook_(cfg_());
    if (!ids.length) return 'No mock test posts to delete.';
    if (!url) return 'No Discord webhook in Config.';
    if (ui.alert('Delete ' + ids.length + ' 🧪 TEST posts from Discord?', 'Only the mock tournament\'s posts are deleted. Real posts are untouched.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return '';
    const base = url.split('?')[0], left = []; let gone = 0;
    ids.forEach((id) => {
      let r = null;
      for (let n = 0; n < 4; n++) {
        r = UrlFetchApp.fetch(base + '/messages/' + id, { method: 'delete', muteHttpExceptions: true });
        if (r.getResponseCode() !== 429) break;
        let w = 2; try { w = Number(JSON.parse(r.getContentText()).retry_after) || 2; } catch (e) { } Utilities.sleep(Math.min(15, w + 0.5) * 1000);
      }
      const c = r.getResponseCode(); if (c === 204 || c === 404) gone++; else left.push(id);
      Utilities.sleep(600);
    });
    props_().setProperty('MOCK_MSGS', JSON.stringify(left));
    return '🗑️ Deleted ' + gone + ' test post' + (gone === 1 ? '' : 's') + '.' + (left.length ? ' ' + left.length + ' didn\'t go (Discord busy): run it again.' : '');
  });
}
function adminResetBracket() {
  withUi_((ui) => {
    if (ui.alert('Clear the bracket and every result? Sign-ups stay. Type nothing; just confirm.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return '';
    stateSet_(null); props_().deleteProperty('TOO_FEW_POSTED');
    try { const C = cfg_(); if (norm_(C.FORM_ID)) FormApp.openById(norm_(C.FORM_ID)).setAcceptingResponses(true); } catch (e) { }
    const sh = sheet_(SHEETS.MATCHES); if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    snapshot_(null); wake_(); log_('organizer', 'Reset', 'bracket cleared');
    return 'Cleared. The bracket is drawn again when sign-ups close (or with "Draw the bracket now").';
  });
}

// ===================== Tournament Central: one Sheet runs tournament after tournament =====================
// 🆕 New tournament: archives the one that just finished, clears the tabs, reopens the same sign-up form under the
// new name (same link, so returning players still sign up with a blank form), gives the new tournament its own
// page at /t/<name>/, adds it to the Tournaments page, and (if you like) posts the announcement.
const slug_ = (s) => lc_(s).normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'tournament';
const slugOf_ = (C) => norm_(C.SLUG) || slug_(C.TOURNEY_NAME);
const KIND_NAMES_ = { big: 'BigLeague', pro: 'pro', exhibition: 'exhibition' };
const kindsTxt_ = (C) => norm_(C.ALLOWED_KINDS || 'big').split(/\s*,\s*/).filter(Boolean).map((k) => KIND_NAMES_[lc_(k)] || k).join(' or ');
const starsTxt_ = (C) => { const lo = Number(C.MIN_STARS || 0), hi = Number(C.MAX_STARS || 10); return lo <= 0 && hi >= 10 ? 'Any club' : lo === hi ? lo + '★ clubs' : lo + '–' + hi + '★ clubs'; };
const htmlEsc_ = (s) => norm_(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Every tournament in this Sheet, for the menus.
function slotList_() {
  return slots_().map((sl) => withSlot_(sl, () => {
    const C = cfg_(), T = stateGet_(), n = entrants_().rows.filter((r) => r.Status !== 'Withdrawn').length;
    const status = T ? (T.done ? 'finished' : 'being played') : n ? n + ' signed up, sign-ups ' + (when_(C.SIGNUP_CLOSE, C) > Date.now() ? 'open' : 'closed') : 'no sign-ups yet';
    return { slot: sl, name: norm_(C.TOURNEY_NAME), status, live: !!(T && !T.done), played: !!T, signups: n };
  }));
}
function adminSwitch() {
  const ui = SpreadsheetApp.getUi(), L = slotList_();
  if (L.length < 2) { ui.alert('There\'s one tournament in this Sheet: ' + L[0].name + '.\n\nStart another alongside it with 🆕 New tournament.'); return; }
  const cur = adminSlot_();
  const r = ui.prompt('🔀 Which tournament?', L.map((x, i) => (i + 1) + '. ' + x.name + ' · ' + x.status + (x.slot === cur ? '   ← now' : '')).join('\n') + '\n\nType its number. Settle, undo, draw, health check and the rest then act on that one.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const pick = L[Number(norm_(r.getResponseText())) - 1];
  if (!pick) { ui.alert('No tournament with that number.'); return; }
  PropertiesService['getScriptProperties']().setProperty('ADMIN_SLOT', pick.slot || '');
  onOpen();
  ui.alert('Now working on: ' + pick.name);
}
// 🆕 New tournament: a form in a pop-up box.
function adminNewTournament() {
  withSlot_(adminSlot_(), () => {
    const C = cfg_(), init = {
      slots: slotList_(), fmt: lc_(C.FORMAT) === 'single' ? 'single' : 'double', wave: Number(C.WAVE_MINUTES) || 60, kinds: norm_(C.ALLOWED_KINDS) || 'big',
      minS: Number(C.MIN_STARS || 0), maxS: C.MAX_STARS === '' ? 10 : Number(C.MAX_STARS), max: Number(C.MAX_CLUBS) || 32, prizes: norm_(C.PRIZES), tz: tz_(C),
      gh: !!props_().getProperty('GITHUB_TOKEN') };
    init.slots.forEach((x) => { x.slot = x.slot || ''; });
    const html = NEW_HTML_.replace('__INIT__', () => JSON.stringify(init).replace(/</g, '\\u003c'));
    SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(540).setHeight(680), '🆕 New tournament');
  });
}
// The same thing as plain question boxes: a backup for browsers where Google blocks the pop-up (several Google accounts signed in).
function adminNewTournamentBoxes() {
  withUi_((ui) => {
    const ask = (title, msg) => { const r = ui.prompt(title, msg, ui.ButtonSet.OK_CANCEL); if (r.getSelectedButton() !== ui.Button.OK) throw { cancel: true }; return norm_(r.getResponseText()); };
    const L = slotList_(), src = cfg_(), o = { slot: 'new' };
    // 1. Alongside, or in place of a finished one
    const reusable = L.map((x, i) => ({ x, i })).filter((y) => !y.x.live);
    if (reusable.length) {
      const a = ask('🆕 New tournament (1 of 6)', 'In this Sheet now:\n' + L.map((x, i) => (i + 1) + '. ' + x.name + ' · ' + x.status).join('\n') +
        '\n\nLeave blank (or type "new") to run the new one ALONGSIDE these, with its own sign-up form.\nOr type the number of one that isn\'t being played to put it away and reuse its sign-up link.');
      if (a && !/^new$/i.test(a)) {
        const y = L[Number(a) - 1]; if (!y) return 'No tournament with that number.';
        if (y.live) return 'The ' + y.name + ' is being played, so it can\'t be replaced. Leave the box blank to run the new one alongside it.';
        if (!y.played && y.signups && ui.alert('Replace the ' + y.name + '?', 'It has ' + y.signups + ' sign-up(s) and was never played. They\'re saved to the History tab, and it comes off the Tournaments page.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return '';
        o.slot = y.slot || ''; o.replace = true;
      }
    }
    // 2-6. The details
    o.name = ask('🆕 New tournament (2 of 6)', 'Name, e.g. Sunday Sandlot Scramble');
    if (!o.name) return 'It needs a name.';
    o.close = ask('🆕 New tournament (3 of 6)', 'When do sign-ups close? (Mountain time)\nFormat: yyyy-MM-dd HH:mm, e.g. 2026-12-06 17:00');
    o.start = ask('🆕 New tournament (4 of 6)', 'When does Wave 1 start? (Mountain time)\nFormat: yyyy-MM-dd HH:mm, e.g. 2026-12-06 18:00');
    const def = (lc_(src.FORMAT) === 'single' ? 'single' : 'double') + ', ' + (Number(src.WAVE_MINUTES) || 60) + ' min, ' + (norm_(src.ALLOWED_KINDS) || 'big').replace(/,/g, '+') + ', stars ' + (Number(src.MIN_STARS) || 0) + '-' + (src.MAX_STARS === '' ? 10 : Number(src.MAX_STARS)) + ', ' + (Number(src.MAX_CLUBS) || 32) + ' clubs';
    const st = lc_(ask('🆕 New tournament (5 of 6)', 'Format, minutes per match, game types, stars and max clubs.\nLeave blank for the same as now:\n\n' + def + '\n\nOr type your own in that shape, e.g.  single, 45 min, big+pro, stars 0-10, 16 clubs') || def);
    o.fmt = /scramble/.test(st) ? 'scramble' : /single/.test(st) ? 'single' : 'double';
    o.wave = (/(\d+)\s*min/.exec(st) || [0, src.WAVE_MINUTES || 60])[1];
    o.kinds = ['big', 'pro', 'exhibition'].filter((k) => new RegExp('\\b' + k).test(st)).join(',') || 'big';
    const sr = /stars?\s*(\d+)\s*[-–to ]+\s*(\d+)/.exec(st); o.minS = sr ? sr[1] : 0; o.maxS = sr ? sr[2] : 10;
    o.max = (/(\d+)\s*clubs?/.exec(st) || [0, src.MAX_CLUBS || 32])[1];
    const pz = ask('🆕 New tournament (6 of 6)', 'Prizes? Leave blank for: ' + (norm_(src.PRIZES) || 'none') + '\n\nTo post in a different Discord channel, paste that channel\'s webhook link after the prizes (or on its own). Otherwise it posts where the ' + norm_(src.TOURNEY_NAME) + ' does.');
    const lines = pz.split(/\n|\s+(?=https:\/\/)/); o.prizes = /^https:/.test(lines[0] || '') ? norm_(src.PRIZES) : (lines[0] || norm_(src.PRIZES)); o.webhook = (lines.find((x) => /^https:\/\//.test(x)) || '').trim();
    o.announce = ui.alert('Post the announcement?', 'Post "The ' + o.name + ' is open for sign-ups!" to Discord now?', ui.ButtonSet.YES_NO) === ui.Button.YES;
    const r = newTournament(o);
    try { onOpen(); } catch (e) { }
    return '🎉 ' + r.name + ' is set up' + (r.archived ? ' (' + r.archived + ' saved to History)' : '') + '.' + (r.alongside ? ' It runs alongside the others, and the menu now works on it (🔀 to switch).' : '') +
      '\n\nSign-up form: ' + r.form + (r.alongside ? '\n👥 One check on the new form: Published → Responders → Anyone with the link (business-account forms start company-only).' : '') + '\nBracket page: ' + r.url + '\n\n' + healthText_(r.health, true);
  });
}

// o: { slot ('new' = alongside, '' = the first tournament, '2'... = that one; default: the one you're working on), name, close, start,
//      wave, fmt, kinds, minS, maxS, max, prizes, webhook, announce, replace }
function newTournament(o) {
  if (CUR_ === null && adminSlot_()) return withSlot_(adminSlot_(), () => newTournament(o));   // called from the pop-up
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (o.slot === 'new') { const src = cfg_(), id = addSlot_(src); const r = withSlot_(id, () => startIn_(o, src)); props_()['setProperty']('ADMIN_SLOT', id); r.alongside = true; return r; }
    return withSlot_(o.slot === undefined ? CUR_ : (o.slot || null), () => startIn_(o, null));
  } finally { lock.releaseLock(); }
}
// A new slot: its own settings (Discord, Hill and GitHub settings come from the tournament you're on), tabs and form.
function addSlot_(src) {
  const pr = PropertiesService['getScriptProperties'](), have = slots_().filter(Boolean).map(Number), id = String(Math.max.apply(null, [1].concat(have)) + 1);
  pr.setProperty('SLOTS', JSON.stringify(have.map(String).concat([id])));
  const carry = { DISCORD_WEBHOOK_URL: 1, LOG_WEBHOOK_URL: 1, HILL_SHEET_ID: 1, TZ: 1, GITHUB_REPO: 1, TOURNAMENTS_PATH: 1, NO_SHOW: 1, TIE_RULE: 1, SEEDING: 1, GRAND_FINAL_RESET: 1, PREVIEW_SIZE: 1, POST_DELAY_MINUTES: 1, PRIZES: 1 };
  withSlot_(id, () => {
    const sh = sheet_(SHEETS.CONFIG, ['Key', 'Value', 'Notes']); sh.getRange('B:B').setNumberFormat('@');
    Object.keys(DEFAULTS).forEach((k) => sh.appendRow([k, carry[k] ? norm_(src[k]) : /^(FORM_ID|FORM_LINK|BOARD_LINK|SLUG)$/.test(k) ? '' : DEFAULTS[k][0], DEFAULTS[k][1]]));
    sheet_(SHEETS.ENTRANTS, ENTRANT_COLS).getRange('C:C').setNumberFormat('@');
    [SHEETS.MATCHES, SHEETS.STATE, SHEETS.BOARD].forEach((n) => sheet_(n));
    const form = makeForm_('New tournament'); setCfg_('FORM_ID', form.getId()); setCfg_('FORM_LINK', form.getPublishedUrl());
    ScriptApp.newTrigger('onTourneyFormSubmit').forForm(form).onFormSubmit().create();
  });
  return id;
}
function startIn_(o, fresh) {
  {
    const C = cfg_(), T = stateGet_(), ents = entrants_().rows.filter((r) => r.Status !== 'Withdrawn');
    const name = norm_(o.name).slice(0, 60);
    // Safety first: never pull the rug out from under a tournament that's being played.
    if (T && !T.done) fail_('The ' + norm_(C.TOURNEY_NAME) + ' is still being played. Let it finish (or use 🧹 Start over) before starting a new one.');
    if (!T && ents.length && !o.replace) fail_('The ' + norm_(C.TOURNEY_NAME) + ' has ' + ents.length + ' sign-up' + (ents.length === 1 ? '' : 's') + ' and hasn\'t been played. Tick "Replace it" to drop it and start fresh.');
    if (!name) fail_('Give the tournament a name.');
    const tz = tz_(C), when = (v) => when_(norm_(v).replace('T', ' '), { TZ: tz });
    const close = when(o.close), start = when(o.start), wave = Math.round(Number(o.wave) || 60);
    if (!close || !start) fail_('Pick when sign-ups close and when Wave 1 starts.');
    if (close <= Date.now()) fail_('Sign-ups would already be closed: pick a later close time.');
    if (start < close) fail_('Wave 1 has to start after sign-ups close.');
    if (wave < 15 || wave > 24 * 60) fail_('Minutes per match: somewhere from 15 to 1440.');
    const minS = Number(o.minS || 0), maxS = Number(o.maxS === '' || o.maxS == null ? 10 : o.maxS), max = Math.round(Number(o.max) || 32);
    if (!(minS >= 0 && maxS <= 10 && minS <= maxS)) fail_('Stars: a range inside 0–10.');
    if (max < 2 || max > 64) fail_('Max clubs: 2 to 64.');
    const kinds = norm_(o.kinds || 'big').split(/\s*,\s*/).map(lc_).filter((k) => KIND_NAMES_[k]);
    if (!kinds.length) fail_('Pick at least one game type.');
    const hook = norm_(o.webhook);
    if (hook && !/^https:\/\/(\w+\.)?discord(app)?\.com\/api\/webhooks\//.test(hook)) fail_('That doesn\'t look like a Discord webhook link.');

    // 1. Put the old one away.
    const old = archive_(C, T, ents);
    // 2. A web name nobody has used yet.
    let slug = slug_(name); const taken = old.taken; taken[old.slug] = 1;
    slots_().forEach((sl) => { if (sl !== CUR_) taken[withSlot_(sl, () => slugOf_(cfg_()))] = 1; });
    if (taken[slug]) { let k = 2; while (taken[slug + '-' + k]) k++; slug = slug + '-' + k; }
    // 3. The new settings.
    const set = { TOURNEY_NAME: name, SLUG: slug, SIGNUP_CLOSE: fmtCfg_(close, tz), START: fmtCfg_(start, tz), WAVE_MINUTES: String(wave),
      FORMAT: o.fmt === 'scramble' ? 'scramble' : o.fmt === 'single' ? 'single' : 'double', ALLOWED_KINDS: kinds.join(','), MIN_STARS: String(minS), MAX_STARS: String(maxS),
      MAX_CLUBS: String(max), PRIZES: norm_(o.prizes), GITHUB_PATH: 'docs/t/' + slug + '/bracket.json' };
    if (hook) set.DISCORD_WEBHOOK_URL = hook;
    Object.keys(set).forEach((k) => setCfg_(k, set[k]));
    const pr = props_();
    setCfg_('BOARD_LINK', pr.getProperty('GITHUB_TOKEN') && !pr.getProperty('GH_BAD') ? ghPageUrl_(cfg_()) : '');
    // 4. A clean slate (the Roster of everyone who ever signed up stays, so blank forms keep working).
    stateSet_(null);
    clearRows_(SHEETS.ENTRANTS); clearRows_(SHEETS.MATCHES); sheet_(SHEETS.BOARD).getRange(1, 1).setValue('');
    ['NEXT_AT', 'TOO_FEW_POSTED', 'GH_HASH', 'FORM_LINKED', 'IDX_HASH', 'HEALTH_RAN'].forEach((k) => pr.deleteProperty(k));
    CFG_CACHE = null; const C2 = cfg_();
    // 5. The same form, renamed and reopened.
    try { if (norm_(C2.FORM_ID)) FormApp.openById(norm_(C2.FORM_ID)).setTitle(name + ' · sign-up').setDescription(FORM_DESC).setAcceptingResponses(true); }
    catch (e) { log_('system', 'Form not reopened', String(e.message || e)); }
    // 6. Its own page, then the (empty) bracket data and the Tournaments list.
    ghPut_(pageDir_(C2) + 'index.html', pageHtml_(C2), 'New tournament page: ' + name);
    snapshot_(null);
    log_('organizer', 'New tournament', name + ' (' + slug + ')' + (old.name ? ' · archived ' + old.name : ''));
    if (o.announce) post_(announceText_(C2));
    wake_();
    return { ok: true, name, url: boardUrl_(C2), form: norm_(C2.FORM_LINK), archived: old.name || '', health: health_(C2) };
  }
}
const fmtCfg_ = (t, tz) => Utilities.formatDate(new Date(t), tz, 'yyyy-MM-dd HH:mm');
const pageDir_ = (C) => (norm_(C.GITHUB_PATH) || 'docs/brawl/bracket.json').replace(/[^/]*$/, '');
function clearRows_(name) { const sh = sheet_(name); if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(1, sh.getLastColumn())).clearContent(); }

// Saves who played (and who won) on the History tab, and marks the old one finished on the Tournaments page.
function archive_(C, T, ents) {
  const out = { name: '', slug: slugOf_(C), taken: {} };
  let list = []; try { list = (JSON.parse(ghGet_(idxPath_(C)) || '{}').list) || []; } catch (e) { }
  list.forEach((x) => { out.taken[x.slug] = 1; });
  if (!ents.length && !T) { try { updateIndex_(null, { drop: out.slug }); } catch (e) { } return out; }   // never played, nobody in: just off the list
  out.name = norm_(C.TOURNEY_NAME);
  const champ = T && T.done ? champion_(T) : null, runner = T && T.runner, seeds = {};
  if (T) T.seeds.forEach((s) => { seeds[s.club] = s.seed; });
  const H = ['Tournament', 'Slug', 'Finished', 'Place', 'Email', 'Discord', 'DiscordID', 'Club', 'ClubID', 'Stars', 'Seed'];
  const sh = sheet_('History', H), when = T && T.done ? new Date(T.done) : now_();
  const rows = ents.map((r) => { const id = Number(r.ClubID);
    return [out.name, out.slug, when, !T ? 'Not played' : id === champ ? '🏆 Champion' : id === runner ? '🥈 Runner-up' : 'Played', r.Email, r.Discord, norm_(r.DiscordID), r.Club, r.ClubID, r.Stars, seeds[id] || '']; });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, H.length).setValues(rows);
  if (T && T.done) { try { snapshot_(T); } catch (e) { } }             // the final bracket stays up at its own link
  else try { updateIndex_(null, { drop: out.slug }); } catch (e) { }   // never played: off the list
  return out;
}

// The bracket page for this tournament's folder: the same page as the Apps Script one, reading its bracket.json.
const VAULT_PILL_ = '<a id="vault-pill" href="https://slipnsliders.github.io/smallball-tools/vault/" target="_blank" rel="noopener" style="position:fixed;left:14px;bottom:14px;z-index:50;display:flex;align-items:center;gap:8px;text-decoration:none;font:800 14px/1 system-ui,sans-serif;color:#1b1300;background:linear-gradient(135deg,#fde68a,#f59e0b);border-radius:999px;padding:11px 16px;box-shadow:0 8px 24px rgba(0,0,0,.45)">🏦 Prize Vault · 🎁 Donate a ticket</a>';
function pageHtml_(C) {
  const name = norm_(C.TOURNEY_NAME) || 'SmallBall Tournament', repo = norm_(C.GITHUB_REPO) || 'slipnsliders/smallball-tools', path = norm_(C.GITHUB_PATH);
  const head = '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + htmlEsc_(name) + ' · live bracket</title>\n' +
    '<meta property="og:title" content="' + htmlEsc_(name) + ' · live bracket"><meta property="og:description" content="A SmallBall ' + (lc_(C.FORMAT) === 'single' ? 'single' : 'double') + '-elimination tournament. Sign up, see the bracket, follow every result.">';
  const src = ['https://api.github.com/repos/' + repo + '/contents/' + path + '?ref=main', 'https://raw.githubusercontent.com/' + repo + '/main/' + path, 'bracket.json'];
  const loader = 'var SRC=' + JSON.stringify(src) + ",last='';\n" +
    'function load(i){\n  i=i||0;if(i>=SRC.length)return;\n  var u=SRC[i]+(i?(SRC[i].indexOf(\'?\')<0?\'?\':\'&\')+\'t=\'+Date.now():\'\');\n' +
    "  fetch(u,{cache:'no-store',headers:i===0?{Accept:'application/vnd.github.raw+json'}:{}})\n" +
    '    .then(function(r){if(!r.ok)throw r.status;return r.text()})\n' +
    "    .then(function(txt){var d=JSON.parse(txt);if(txt!==last&&!document.getElementById('shot')){var op=document.querySelector('details.rules');last=txt;D=d;render();var np=document.querySelector('details.rules');if(op&&np)np.open=op.open;}})\n" +
    '    .catch(function(){load(i+1)});\n}\nrender();load();\n' +
    "setInterval(function(){if(!document.hidden)load()},90000);\ndocument.addEventListener('visibilitychange',function(){if(!document.hidden)load()});";
  const reload = "render();\nif(!/demo=1/.test(location.search))setTimeout(function(){location.reload()},60000);";
  let t = isScr_(C) ? GOLF_HTML_ : BRACKET_HTML_;
  if (t.indexOf(reload) < 0 || t.indexOf('var D=__DATA__;') < 0) throw new Error('bracket page template changed');
  t = t.replace('</body>', () => VAULT_PILL_ + '</body>');
  t = t.replace('<meta charset="utf-8">', () => head).replace('var D=__DATA__;', () => 'var D=' + JSON.stringify({ name }).replace(/</g, '\\u003c') + ';').replace(reload, () => loader);
  return t;
}

// ----- 🏦 The Prize Vault: club 1008's ticket tray, published for everyone to see -----
// Donors gift tickets to the vault club from their trainer tray. Only the owner can see a tray, so this reads
// it with the connected SmallBall login (🔑) once an hour and saves docs/vault/vault.json for the Prize Vault page.
// A running ledger (who gave what, what has left the vault) keeps donors on the wall after their tickets go out.
const VAULT_CLUB_DEFAULT = 1008;
const VAULT_SKILL_ = { pitch_skill: 'Pitching', catch_skill: 'Catching', pass_power: 'Throwing', run_speed: 'Running', swing_skill: 'Bat Skill', swing_power: 'Bat Power', contact_odds: 'Bat Contact' };
// Tier 1 = the champion's prizes ($5–8), Tier 2 = runner-up ($2–3), Tier 3 = semifinalists ($1).
function vaultTicket_(t) {
  const k = String(t.kind || '').toLowerCase(), arg = String(t.arg || '');
  if (/manual/.test(k)) return null;   // the free Owner's Manual isn't a prize
  if (k === 'qt' && VAULT_SKILL_[arg]) return { label: 'Quick Train: ' + VAULT_SKILL_[arg], tier: 3 };
  if (/qt|quick/.test(k) && /pack|all|seven/.test(k + arg)) return { label: 'Quick Train Pack (all seven skills)', tier: 1 };
  if (/ticket.?pack|pack/.test(k)) return { label: 'The Ticket Pack', tier: 1 };
  if (t.park_name || /park|stadium/.test(k)) return { label: 'Stadium: ' + (t.park_name || 'a new park'), tier: 1 };
  if (/abat|alum|bat$/.test(k)) return { label: 'Aluminum Bat', tier: 1 };
  if (/deluxe/.test(k)) return { label: 'Deluxe Trainer', tier: 1 };
  if (/holiday/.test(k)) return { label: 'Holiday', tier: 2 };
  if (/field.?ball/.test(k)) return { label: 'Field Balls', tier: 2 };
  if (/camp/.test(k)) return { label: 'Batting Camp', tier: 2 };
  if (/balance/.test(k)) return { label: 'Balance', tier: 2 };
  if (/name/.test(k)) return { label: 'Name Changer', tier: 2 };
  return { label: k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || 'Ticket', tier: 2 };
}
function vaultTick_(force) {
  const sp = PropertiesService['getScriptProperties']();
  if (!force && sp.getProperty('VAULT_LEDGER') && Date.now() < Number(sp.getProperty('VAULT_NEXT') || 0)) return '';
  sp.setProperty('VAULT_NEXT', String(Date.now() + 10 * 60000));   // pushed out to an hour once it works
  const ck = sbCookie_(); if (!ck) return 'No SmallBall login connected (🔑).';
  if (!sp.getProperty('GITHUB_TOKEN') || sp.getProperty('GH_BAD')) return 'GitHub is not connected (🐙).';
  const club = Number(sp.getProperty('VAULT_CLUB') || VAULT_CLUB_DEFAULT);
  let r; try { r = UrlFetchApp.fetch('https://play.smallball.com/teams/' + club + '/profile', { muteHttpExceptions: true, headers: { Accept: 'application/json', Cookie: ck } }); } catch (e) { return 'SmallBall did not answer.'; }
  const code = r.getResponseCode();
  if (code === 401 || code === 403) { sp.setProperty('SB_BAD', String(Date.now())); return 'The SmallBall login has expired (🔑 to reconnect).'; }
  if (code !== 200) return 'SmallBall answered ' + code + '.';
  let d; try { d = JSON.parse(r.getContentText()); } catch (e) { return 'Unreadable club data.'; }
  if (!d.mine || !d.inventory) return 'The connected login does not own club ' + club + ', so its tray is hidden.';
  let led = {}; try { led = JSON.parse(sp.getProperty('VAULT_LEDGER') || '{}'); } catch (e) { led = {}; }
  const now = Date.now(), inTray = {}, tickets = [];
  for (const t of (d.inventory.tickets || [])) {
    const v = vaultTicket_(t); if (!v) continue;
    const id = String(t.ticket_id); inTray[id] = 1;
    const fromOwn = t.gift_from == null;   // in the vault's tray but not gifted (bought for the vault, or a site gift)
    const L = led[id] || (led[id] = { label: v.label, tier: v.tier, from: fromOwn ? null : t.gift_from, by: fromOwn ? 'The commish' : (t.gift_from_name || ('club ' + t.gift_from)), at: Date.parse(t.granted_at || '') || now });
    L.label = v.label; L.tier = v.tier; delete L.out;
    tickets.push({ id, label: v.label, tier: v.tier, by: L.by, from: L.from, at: L.at });
  }
  Object.keys(led).forEach((id) => { if (!inTray[id] && !led[id].out) led[id].out = now; });   // left the vault: given out as a prize
  const ids = Object.keys(led).sort((a, b) => (led[b].out || led[b].at) - (led[a].out || led[a].at)).slice(0, 400), nl = {}; ids.forEach((id) => (nl[id] = led[id])); led = nl;
  sp.setProperty('VAULT_LEDGER', JSON.stringify(led)); sp.setProperty('VAULT_NEXT', String(Date.now() + 55 * 60000));
  const donors = {};
  Object.values(led).forEach((L) => { if (!L.from && L.by === 'The commish') return; const k = L.by; const o = donors[k] || (donors[k] = { name: k, club: L.from, n: 0, last: 0 }); o.n++; o.last = Math.max(o.last, L.at); });
  const given = Object.values(led).filter((L) => L.out).sort((a, b) => b.out - a.out).slice(0, 30).map((L) => ({ label: L.label, tier: L.tier, by: L.by, out: L.out }));
  const snap = { updated: now, club: { id: club, name: d.name || '' }, tickets: tickets.sort((a, b) => a.tier - b.tier || a.at - b.at),
    donors: Object.values(donors).sort((a, b) => b.n - a.n || b.last - a.last), given };
  return withSlot_(null, () => ghPut_('docs/vault/vault.json', JSON.stringify(snap), '🏦 Prize Vault: ' + tickets.length + ' ticket' + (tickets.length === 1 ? '' : 's'), JSON.stringify(Object.assign({}, snap, { updated: 0 })))) ? '' : 'GitHub save failed (see the Log).';
}
function adminTwoPerOwner() {   // for the tournament picked in the menu
  withUi_(() => { setCfg_('MAX_PER_OWNER', 2); snapshot_(); return '👥 ' + norm_(cfg_().TOURNEY_NAME) + ': owners can now sign up a second club (one form each). Set MAX_PER_OWNER in its Config back to 1 to undo.'; });
}
function adminVaultNow() {
  withUi_((ui) => { const why = vaultTick_(true); ui.alert('🏦 Prize Vault', why || 'Updated. The Prize Vault page shows it within a minute or two.', ui.ButtonSet.OK); });
}

// ----- The Tournaments page: docs/tournaments/index.json lists every tournament any Sheet has run -----
const idxPath_ = (C) => norm_(C.TOURNAMENTS_PATH) || 'docs/tournaments/index.json';
function indexEntry_(C, snap) {
  const p = (c) => (c ? { n: c.n, o: c.o || '', id: c.id } : null);
  return { slug: slugOf_(C), name: norm_(C.TOURNEY_NAME), url: boardUrl_(C), form: norm_(C.FORM_LINK), prizes: norm_(C.PRIZES),
    fmt: isScr_(C) ? 'scramble' : lc_(C.FORMAT) === 'single' ? 'single' : 'double', kinds: kindsTxt_(C), stars: starsTxt_(C), wave: Math.round(waveMs_(C) / 60000),
    signupClose: when_(C.SIGNUP_CLOSE, C), start: when_(C.START, C), clubs: snap.entrants ? snap.entrants.length : 0,
    status: snap.done ? 'done' : snap.matches ? 'live' : 'signups', finished: snap.done ? (stateGet_() || {}).done || Date.now() : 0,
    champ: p(snap.champ), runner: p(snap.runner) };
}
// Only touches GitHub when this tournament's line actually changes (status, sign-up count, champion...).
function updateIndex_(snap, opt) {
  const pr = props_(); opt = opt || {};
  if (!pr.getProperty('GITHUB_TOKEN') || pr.getProperty('GH_BAD')) return false;
  const C = cfg_(), e = snap ? indexEntry_(C, snap) : null;
  const key = opt.drop ? 'drop:' + opt.drop : JSON.stringify(e);
  if (pr.getProperty('IDX_HASH') === key) return true;
  let doc = {}; try { doc = JSON.parse(ghGet_(idxPath_(C)) || '{}'); } catch (x) { doc = {}; }
  let list = Array.isArray(doc.list) ? doc.list : [];
  if (opt.drop) list = list.filter((x) => x.slug !== opt.drop);
  if (e) list = list.filter((x) => x.slug !== e.slug && x.url !== e.url).concat([e]);
  list.sort((a, b) => (b.start || 0) - (a.start || 0));
  const ok = ghPut_(idxPath_(C), JSON.stringify({ updated: Date.now(), list }, null, 1), 'Tournaments page: ' + (e ? e.name + ' (' + e.status + ')' : 'removed ' + opt.drop), JSON.stringify(list), true);
  if (ok) pr.setProperty('IDX_HASH', key);
  return ok;
}

// The sign-ups-open post for Discord.
function announceText_(C) {
  C = C || cfg_();
  if (isScr_(C)) return scrAnnounce_(C);
  const nIn = (() => { try { return entrants_().rows.filter((r) => r.Status !== 'Withdrawn').length; } catch (e) { return 0; } })();
  const close = when_(C.SIGNUP_CLOSE, C), start = when_(C.START, C), f = norm_(C.FORM_LINK), b = boardUrl_(C);
  const lines = ['# 🏆 The ' + esc_(C.TOURNEY_NAME) + ' is open for sign-ups!',
    'A SmallBall **' + (isScr_(C) ? '⛳ Two Man Scramble' : lc_(C.FORMAT) === 'single' ? 'single-elimination' : 'double-elimination (two losses and you\'re out)') + '** tournament · ' + starsTxt_(C) + ' · ' + kindsTxt_(C) + ' games only · up to ' + (Number(C.MAX_CLUBS) || 32) + ' clubs.',
    ''];
  if (f) lines.push('📝 **[Sign up here](<' + f + '>)**: played here or on Hold the Hill before? Just submit the blank form.');
  if (close) lines.push('🗓️ Sign-ups close ' + '<t:' + Math.floor(close / 1000) + ':F> (' + tsR_(close) + ').');
  if (start) lines.push('🔔 Wave 1 starts <t:' + Math.floor(start / 1000) + ':F>. Every match gets **' + Math.round(waveMs_(C) / 60000) + ' minutes**, and your next match opens the moment both clubs are known.');
  lines.push('🥊 The lower seed starts the game, the higher seed defends. No reporting: the script finds the game and posts the result once it airs.');
  if (norm_(C.PRIZES)) lines.push('🎁 Prizes: ' + esc_(C.PRIZES));
  if (nIn) lines.push('🔥 **' + nIn + ' club' + (nIn === 1 ? '' : 's') + '** already in.');
  if (b) lines.push('🗂️ [Live bracket](<' + b + '>) · fills in as people sign up');
  return lines.join('\n');
}

// ----- 18 holes of match play, from each game's inning-by-inning box score -----
// Holes 1-9 are innings 1-9 of the front-nine games, holes 10-18 the back-nine games. On each hole a team takes its
// better inning of its two clubs (the scramble). More runs wins the hole; the same halves it. Golf names on the card:
// 0 runs = par, 1 = birdie, 2 = eagle, 3+ = albatross. A home club that didn't need its bottom of the 9th gets a gimme.
// Box scores need a SmallBall login, so the organizer connects one (🔑 in the menu). Without it: the Nassau.
const GIMME_RUNS_ = 1;
function sbCookie_() { return PropertiesService['getScriptProperties']().getProperty('SB_COOKIE') || ''; }
function gameRecord_(gid) {
  const ck = sbCookie_(); if (!ck) return { err: 'no login connected' };
  let r; try { r = UrlFetchApp.fetch('https://play.smallball.com/games/' + encodeURIComponent(gid), { muteHttpExceptions: true, headers: { Accept: 'application/json', Cookie: ck } }); } catch (e) { return { err: String(e.message || e) }; }
  const code = r.getResponseCode();
  if (code === 401 || code === 403) { PropertiesService['getScriptProperties']().setProperty('SB_BAD', String(Date.now())); return { err: 'the SmallBall login has expired' }; }
  if (code !== 200) return { err: 'SmallBall answered ' + code };
  try { const g = JSON.parse(r.getContentText()); return g && g.result && g.result.line ? { g } : { err: 'no box score in the game record' }; } catch (e) { return { err: 'unreadable game record' }; }
}
// Read the box scores of a match's games (each game once). Returns '' when all were read, or why not.
function readLines_(m) {
  for (const g of (m.games || [])) {
    if (!g.gid || g.la) continue;
    const x = gameRecord_(g.gid); if (x.err) return x.err;
    const L = x.g.result.line, aAway = String(x.g.away_team_id) === String(g.a);
    g.la = (aAway ? L.away : L.home || []).slice(0, 9); g.lb = (aAway ? L.home : L.away || []).slice(0, 9); g.aAway = aAway;
  }
  return '';
}
function holes_(m) {
  const G = {}; (m.games || []).forEach((g) => { G[g.k] = g; });
  const inn = (g, side, i) => {   // one club's runs in one inning; null = no game
    if (!g || !g.gid || !g.la) return null;
    const line = side === 'a' ? g.la : g.lb, home = side === 'a' ? (g.homeA != null ? g.homeA : !g.aAway) : (g.homeB != null ? g.homeB : g.aAway), v = line[i];
    if (v == null || v === '' || String(v).toLowerCase() === 'x') return i === 8 && home ? GIMME_RUNS_ : 0;
    return Number(v) || 0;
  };
  const team = (side) => { const out = [];
    for (let h = 0; h < 18; h++) { const ks = h < 9 ? ['F1', 'F2'] : ['K1', 'K2'], v = ks.map((k) => inn(G[k], side, h % 9)).filter((x) => x != null);
      out.push(v.length ? Math.max.apply(null, v) : null); }
    return out; };
  const A = team('a'), B = team('b');
  let diff = 0, res = '', clinch = 0; const run = [];
  for (let h = 0; h < 18; h++) {
    const a = A[h] == null ? -1 : A[h], b = B[h] == null ? -1 : B[h];
    diff += a > b ? 1 : a < b ? -1 : 0; run.push(diff);
    if (!res && Math.abs(diff) > 17 - h) { res = Math.abs(diff) + (17 - h ? ' & ' + (17 - h) : ' UP'); clinch = h + 1; }
  }
  if (!res) res = diff ? Math.abs(diff) + ' UP' : 'AS';
  const sum = (x) => x.reduce((s, v) => s + (v || 0), 0), cnt = (x, f) => x.filter((v) => v != null && f(v)).length;
  const card = (x) => ({ out: -sum(x.slice(0, 9)), inn: -sum(x.slice(9)), par: -sum(x), bird: cnt(x, (v) => v === 1), eagle: cnt(x, (v) => v === 2), alb: cnt(x, (v) => v >= 3) });
  const lead = diff > 0 ? 'a' : diff < 0 ? 'b' : (sum(A) !== sum(B) ? (sum(A) > sum(B) ? 'a' : 'b') : '');
  return { a: A, b: B, run, res, clinch, lead, tieBy: diff ? '' : lead ? 'to par' : '', ca: card(A), cb: card(B) };
}
const toPar_ = (n) => (n === 0 ? 'E' : n > 0 ? '+' + n : String(n).replace('-', '−'));
// 🔑 Connect a SmallBall login, so Scramble matches can be scored hole by hole from the box scores.
function adminConnectSmallBall() {
  const ui = SpreadsheetApp.getUi(), pr = PropertiesService['getScriptProperties']();
  const r = ui.prompt('🔑 Connect SmallBall box scores',
    'The Scramble scores hole by hole from each game\'s box score, which SmallBall only shows to someone logged in. Paste your SmallBall login here and the script reads box scores with it (read-only, nothing else). It\'s kept in the script\'s private settings, not on any tab.\n\n' +
    'Easiest way: on play.smallball.com (logged in) press Ctrl+Shift+I → Network tab → reload the page → right-click any row (like "live" or "all?club=…") → Copy → Copy as cURL, then paste the whole thing here. The script picks out the part it needs.\n\nLeave it blank and click OK to disconnect.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const v = sbCookieFrom_(r.getResponseText());
  if (!v) { pr.deleteProperty('SB_COOKIE'); pr.deleteProperty('SB_BAD'); ui.alert('SmallBall box scores disconnected. Scramble matches are scored as a Nassau.'); return; }
  pr.setProperty('SB_COOKIE', v); pr.deleteProperty('SB_BAD');
  ui.alert(sbTest_().msg);
}
// 🧪 Practice round: real box scores, no tournament needed. Four clubs; each club's two latest BigLeague games stand in for
// its front and back nine. The result goes to a practice page (with the scorecard and matchup card), never to Discord.
function adminPracticeRound() {
  withUi_((ui) => {
    if (!sbCookie_()) return 'Connect SmallBall first: 🔑 Connect SmallBall box scores.';
    const def = entrants_().rows.filter((r) => r.Status !== 'Withdrawn').slice(0, 4).map((r) => norm_(r.ClubID)).filter(Boolean);
    const r = ui.prompt('🧪 Practice round (box-score test)', 'Four club IDs: Team A is the first two, Team B the last two. Each club\'s two latest BigLeague games stand in for its front and back nine. Nothing is posted to Discord.\n\n' + (def.length === 4 ? 'Leave blank for: ' + def.join(' ') : 'Example: 8897 131351 640335 643394'), ui.ButtonSet.OK_CANCEL);
    if (r.getSelectedButton() !== ui.Button.OK) return '';
    const ids = (norm_(r.getResponseText()) || def.join(' ')).match(/\d+/g) || [];
    if (ids.length !== 4) return 'Please give exactly four club IDs.';
    const P = practice_(ids);
    if (P.err) return P.err;
    return '🧪 ' + P.text + '\n\nScorecard: ' + P.url + '#m=P1\n(GitHub takes a minute the first time.)';
  });
}
function practice_(ids) {
  const per = {};
  for (const id of ids) {
    let rows; try { rows = clubGames_(id).filter((g) => lc_(g.kind) === 'big' && g.away_runs != null).slice(0, 2); } catch (e) { return { err: 'SmallBall error: ' + (e.message || e) }; }
    if (rows.length < 2) return { err: 'Club ' + id + ' has fewer than two BigLeague games.' };
    per[id] = [];
    for (const row of rows) {
      const x = gameRecord_(row.game_id); if (x.err) return { err: 'Couldn\'t read game ' + row.game_id + ': ' + x.err };
      const away = String(x.g.away_team_id) === String(id), L = x.g.result.line;
      per[id].push({ gid: String(row.game_id), inn: ((away ? L.away : L.home) || []).slice(0, 9), home: !away, name: norm_(away ? row.away_name : row.home_name) || 'Club ' + id });
    }
  }
  const [a1, a2, b1, b2] = ids, F = 1, K = 0;   // the older game is the front nine, the latest the back nine
  const mk = (k, ca, cb, i) => ({ k, a: ca, b: cb, gid: per[ca][i].gid + '/' + per[cb][i].gid, la: per[ca][i].inn, lb: per[cb][i].inn, homeA: per[ca][i].home, homeB: per[cb][i].home });
  const m = { games: [mk('F1', a1, b1, F), mk('F2', a2, b2, F), mk('K1', a1, b2, K), mk('K2', a2, b1, K)] };
  const mp = holes_(m), club = (id) => ({ id: Number(id), n: per[id][0].name, o: '' });
  const A = { id: TEAM0_ + 1, n: 'Team ' + per[a1][0].name + ' & ' + per[a2][0].name, s: 1, how: 'picked', clubs: [club(a1), club(a2)] };
  const B = { id: TEAM0_ + 2, n: 'Team ' + per[b1][0].name + ' & ' + per[b2][0].name, s: 2, how: 'picked', clubs: [club(b1), club(b2)] };
  const sum = (x) => x.reduce((t, v) => t + (v || 0), 0);
  const w = mp.lead === 'b' ? B : A, how = mp.tieBy || (mp.lead ? '' : 'higher seed');
  const M = { id: 'P1', b: 'W', r: 1, l: 'Practice round', a: A, z: B, w: w.id, how, mp: { a: mp.a, b: mp.b, run: mp.run, res: mp.res, clinch: mp.clinch, ca: mp.ca, cb: mp.cb }, v: false, bye: false, open: false };
  const C = cfg_(), repo = norm_(C.GITHUB_REPO) || 'slipnsliders/smallball-tools', path = 'docs/t/practice/bracket.json';
  const PC = { TOURNEY_NAME: 'Practice Round', GITHUB_REPO: repo, GITHUB_PATH: path, FORMAT: 'scramble' };
  const snap = { name: 'Practice Round', updated: Date.now(), fmt: 'scramble', done: true, champ: w, seeds: [A, B], matches: [M], entrants: [], prizes: 'Bragging rights' };
  ghPut_('docs/t/practice/index.html', pageHtml_(PC), 'Practice round page');
  ghPut_(path, JSON.stringify(snap), 'Practice round: ' + A.n + ' vs ' + B.n, null, true);
  const games = ids.map((id) => id + ': front ' + per[id][F].gid + ', back ' + per[id][K].gid).join(' · ');
  log_('organizer', 'Practice round', A.n + ' vs ' + B.n + ' → ' + mp.res + ' · ' + games);
  const text = w.n + ' win ' + (mp.res === 'AS' ? '(all square, ' + (how || 'tie') + ')' : mp.res) + '\n' + A.n + ': ' + toPar_(mp.ca.par) + ' (' + mp.ca.bird + ' birdies, ' + mp.ca.eagle + ' eagles, ' + mp.ca.alb + ' albatross)\n' + B.n + ': ' + toPar_(mp.cb.par) + ' (' + mp.cb.bird + ' birdies, ' + mp.cb.eagle + ' eagles, ' + mp.cb.alb + ' albatross)\n\nHoles (runs): ' + A.n + ' ' + mp.a.map((v) => (v == null ? '·' : v)).join(' ') + '\n' + B.n + ' ' + mp.b.map((v) => (v == null ? '·' : v)).join(' ') + '\n\nGames used: ' + games;
  return { text, url: ghPageUrl_(PC), mp, A, B, w };
}
// Accepts the cookie line itself, "cookie: ..." or a whole "Copy as cURL" / "Copy as fetch" paste.
function sbCookieFrom_(txt) {
  const t = String(txt || '').trim();
  const m = /-H\s+\$?['"]cookie:\s*([^'"]+)['"]/i.exec(t) || /-b\s+\$?['"]([^'"]+)['"]/i.exec(t) || /["']cookie["']\s*:\s*["']([^"']+)["']/i.exec(t);
  return (m ? m[1] : t.replace(/^cookie:\s*/i, '')).trim();
}
// Reads one real box score with the connected login.
function sbTest_() {
  if (!sbCookie_()) return { ok: false, msg: 'No SmallBall login connected.' };
  let gid = '';
  try { slots_().some((sl) => withSlot_(sl, () => entrants_().rows.some((e) => { const rows = clubGames_(norm_(e.ClubID)); if (rows.length) { gid = String(rows[0].game_id); return true; } return false; }))); } catch (e) { }
  if (!gid) try { gid = String(clubGames_('8897')[0].game_id); } catch (e) { }
  if (!gid) return { ok: false, msg: 'Couldn\'t find a game to test with. Try again in a minute.' };
  const x = gameRecord_(gid);
  if (x.err) return { ok: false, msg: '❌ That didn\'t work (' + x.err + '). Copy the cookie line again and paste it in, making sure you\'re logged in to SmallBall first.' };
  return { ok: true, msg: '✅ Connected! Read the box score of game ' + gid + ' (' + x.g.result.line.away.join('') + ' / ' + x.g.result.line.home.join('') + '). Scramble matches will be scored hole by hole.' };
}

// The Sunday-best version for a ⛳ Two Man Scramble.
function scrAnnounce_(C) {
  const close = when_(C.SIGNUP_CLOSE, C), start = when_(C.START, C), f = norm_(C.FORM_LINK), b = boardUrl_(C);
  const nIn = (() => { try { return entrants_().rows.filter((r) => r.Status !== 'Withdrawn').length; } catch (e) { return 0; } })();
  const L = ['# ⛳ The ' + esc_(C.TOURNEY_NAME) + ' tees off!',
    '**Grab a partner (or let us draw you one) and hit the links.** Two-club teams, four games a match, 18 holes of match play. 🏌️', '',
    '**🏌️ How it plays**',
    '> Every club plays both clubs on the other team: two games on the **front nine**, two on the **back nine**.',
    '> Each team tees off once per nine. One-click start links land right here when your match opens.', '',
    '**⛳ 18 holes of match play**',
    '> Every inning is a hole: innings 1–9 of your front-nine games, then your back nine. Your team plays its **better inning** on each one.',
    '> More runs wins the hole. Most holes takes the match, golf style: *3 & 2*, *1 up*.',
    '> 🐦 **Birdie** = 1 run · 🦅 **Eagle** = 2 · 💥 **Albatross** = 3+. Full scorecards with every birdie circled after each match.',
    '> Single elimination, ' + kindsTxt_(C) + ' games only, ' + Math.round(waveMs_(C) / 60000) + ' minutes a match.', ''];
  if (f) L.push('📝 **[Get on the tee sheet](<' + f + '>)** · got a partner? Put their Discord name in the *Partner* box. Flying solo? We\'ll draw you one. 🎲');
  if (close) L.push('🗓️ Tee sheet closes <t:' + Math.floor(close / 1000) + ':F> (' + tsR_(close) + ')' + (start ? ' · first tee time <t:' + Math.floor(start / 1000) + ':t>' : ''));
  if (nIn) L.push('👀 **' + nIn + ' club' + (nIn === 1 ? '' : 's') + '** on the tee sheet already.');
  if (norm_(C.PRIZES)) L.push('🎁 Prizes: ' + esc_(C.PRIZES));
  if (b) L.push('🗂️ [The course](<' + b + '>): tee sheet now, live scorecards on Sunday');
  L.push('-# No spoilers: a match\'s scores post once all four games have aired. Read-only on SmallBall.');
  return L.join('\n');
}
// 📣 Post (or re-post) the sign-up announcement for the tournament you're working on, after a look at it.
function adminAnnounce() {
  withUi_((ui) => {
    const C = cfg_(), txt = announceText_(C);
    if (!webhook_(C)) return 'No Discord webhook in Config for the ' + norm_(C.TOURNEY_NAME) + '.';
    if (ui.alert('📣 Post this to Discord?', txt.replace(/<t:(\d+):[A-Za-z]>/g, (m, x) => fmtT_(Number(x) * 1000, C)).replace(/\(<(https?:[^>]+)>\)/g, ' ($1)').slice(0, 1800), ui.ButtonSet.YES_NO) !== ui.Button.YES) return '';
    post_(txt); log_('organizer', 'Announcement', norm_(C.TOURNEY_NAME));
    return 'Posted the ' + norm_(C.TOURNEY_NAME) + ' announcement.';
  });
}

// ===================== ✅ Health check =====================
// Everything that bit us before a tournament, checked in one go. Nothing is posted anywhere while checking.
function health_(C) {
  C = C || cfg_();
  const out = [], pr = props_(), add = (s, t, fix) => out.push({ s, t, fix: fix || '' });
  const T = stateGet_(), t = Date.now(), close = when_(C.SIGNUP_CLOSE, C), start = when_(C.START, C);
  const hook = (url) => { try { const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true }); if (r.getResponseCode() !== 200) return 'Discord said ' + r.getResponseCode(); const j = JSON.parse(r.getContentText()); return j && j.channel_id ? '' : 'not a webhook'; } catch (e) { return String(e.message || e); } };
  // Discord
  if (!webhook_(C)) add('bad', 'No Discord webhook', 'Config → DISCORD_WEBHOOK_URL (Discord channel → Edit Channel → Integrations → Webhooks → Copy URL)');
  else { const w = hook(webhook_(C)); w ? add('bad', 'Discord webhook doesn\'t work (' + w + ')', 'Make a new webhook in the channel and paste it into Config → DISCORD_WEBHOOK_URL') : add('ok', 'Discord webhook works'); }
  if (!norm_(C.LOG_WEBHOOK_URL)) add('warn', 'No private log channel', 'Optional: a private channel\'s webhook in Config → LOG_WEBHOOK_URL gets errors and rejections');
  else { const w = hook(norm_(C.LOG_WEBHOOK_URL)); w ? add('bad', 'Log webhook doesn\'t work (' + w + ')', 'Paste a fresh webhook into Config → LOG_WEBHOOK_URL') : add('ok', 'Log channel webhook works'); }
  let q = []; try { q = JSON.parse(pr.getProperty('RETRY_POSTS') || '[]'); } catch (e) { }
  if (q.length) add('warn', q.length + ' Discord post' + (q.length === 1 ? '' : 's') + ' waiting to retry', 'Usually Discord being busy; they go out on their own');
  // The form
  let form = null; try { if (norm_(C.FORM_ID)) form = FormApp.openById(norm_(C.FORM_ID)); } catch (e) { }
  if (!form) add('bad', 'Sign-up form not found', 'Run "Set up / repair"');
  else {
    const open = !T && close > t, acc = form.isAcceptingResponses();
    if (open && !acc) add('bad', 'The form is closed but sign-ups should be open', 'Form → Responses → turn on "Accepting responses"');
    else if (!open && acc && T) add('warn', 'The form is still open after the draw', 'Late sign-ups get a polite ❌; close it in the form if you like');
    else add('ok', 'Form is ' + (acc ? 'open' : 'closed') + ', as it should be');
    let domainOnly = false; try { domainOnly = form.requiresLogin(); } catch (e) { }
    if (domainOnly) add('bad', 'Only people in your Google Workspace can open the form', 'Form → Settings → Responses → untick "Restrict to users in your organization"');
    try { if (!form.collectsEmail()) add('bad', 'The form doesn\'t collect emails, so blank sign-ups can\'t work', 'Run "Set up / repair"'); } catch (e) { }
  }
  if (!norm_(C.FORM_LINK)) add('warn', 'No form link in Config', 'Config → FORM_LINK (the form\'s Send → link)');
  // Triggers and the clock
  let trig = []; try { trig = ScriptApp.getProjectTriggers().map((x) => x.getHandlerFunction()); } catch (e) { }
  if (trig.indexOf('tick') < 0) add('bad', 'The clock isn\'t running', 'Run "Set up / repair" (as the account that should own it)');
  let mine = trig.indexOf('onTourneyFormSubmit') >= 0;
  try { const ts = ScriptApp.getProjectTriggers().filter((x) => x.getHandlerFunction() === 'onTourneyFormSubmit'); if (ts.length && ts[0].getTriggerSourceId) mine = ts.some((x) => x.getTriggerSourceId() === norm_(C.FORM_ID)); } catch (e) { }
  if (!mine) add('bad', 'This tournament\'s form isn\'t hooked up, so its sign-ups are ignored', 'Run "Set up / repair"');
  const nextAt = Number(pr.getProperty('NEXT_AT') || 0);
  if (trig.indexOf('tick') >= 0 && nextAt && nextAt < t - 20 * 60000) add('bad', 'The clock is stuck (last due ' + fmtT_(nextAt, C) + ')', 'Run "🔄 Check SmallBall now"; if it stays stuck, run "Set up / repair"');
  else if (trig.indexOf('tick') >= 0 && mine) add('ok', 'Clock and form triggers are running');
  // GitHub
  const tok = pr.getProperty('GITHUB_TOKEN'), repo = norm_(C.GITHUB_REPO) || 'slipnsliders/smallball-tools';
  if (!tok) add('warn', 'GitHub isn\'t connected, so the bracket page is the Apps Script one', 'Menu → 🐙 Connect the GitHub bracket page');
  else if (pr.getProperty('GH_BAD')) add('bad', 'The GitHub key stopped working; the page is paused', 'Make a key and use 🐙 Connect again (same key on every Sheet that uses it)');
  else {
    let code = 0; try { code = UrlFetchApp.fetch('https://api.github.com/repos/' + repo, { headers: ghHeaders_(tok), muteHttpExceptions: true }).getResponseCode(); } catch (e) { }
    if (code === 200) add('ok', 'GitHub key works'); else add('bad', 'GitHub key rejected (' + (code || 'no answer') + ')', 'Menu → 🐙 Connect the GitHub bracket page with a working key');
  }
  const url = boardUrl_(C);
  if (url) { let code = 0; try { code = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true }).getResponseCode(); } catch (e) { }
    code === 200 ? add('ok', 'Bracket page loads') : add('warn', 'Bracket page didn\'t load (' + (code || 'no answer') + ')', 'Right after 🆕 New tournament, GitHub needs a minute. Otherwise check BOARD_LINK'); }
  // Scramble box scores
  if (isScr_(C) && lc_(C.SCRAMBLE_SCORING || 'holes') !== 'nassau') {
    if (!sbCookie_()) add('warn', 'No SmallBall login connected, so Scramble matches are scored as a Nassau', 'Menu → 🔑 Connect SmallBall box scores, for 18 holes of match play');
    else { const x = sbTest_(); x.ok ? add('ok', 'SmallBall box scores readable: 18 holes of match play') : add('bad', 'SmallBall login stopped working, so Scramble matches fall back to a Nassau', 'Menu → 🔑 Connect SmallBall box scores, and paste a fresh one'); }
  }
  // Returning players
  if (norm_(C.HILL_SHEET_ID)) { let ok = false; try { ok = !!SpreadsheetApp.openById(norm_(C.HILL_SHEET_ID)).getSheetByName('Players'); } catch (e) { }
    ok ? add('ok', 'Hill Sheet readable: Hill players can sign up with a blank form') : add('bad', 'Can\'t read the Hold the Hill Sheet', 'Share the Hill Sheet (Viewer is enough) with the account that runs this script'); }
  // Times
  if (!close || !start) add('bad', 'Sign-up close or start time is missing or unreadable', 'Config → SIGNUP_CLOSE / START as yyyy-MM-dd HH:mm');
  else if (start < close) add('bad', 'Wave 1 starts before sign-ups close', 'Fix SIGNUP_CLOSE / START in Config');
  else if (!T && close < t) add('warn', 'Sign-up close time has passed but there\'s no bracket yet', 'Needs 2+ clubs; or use 🎲 Draw the bracket now');
  else add('ok', T ? (T.done ? 'Finished' : 'Under way') + ': ' + norm_(C.TOURNEY_NAME) : 'Sign-ups close ' + fmtT_(close, C) + ', Wave 1 ' + fmtT_(start, C));
  return out;
}
function healthText_(h, plain) {
  const icon = { ok: '✅', warn: '⚠️', bad: '❌' }, bad = h.filter((x) => x.s === 'bad').length, warn = h.filter((x) => x.s === 'warn').length;
  const top = bad ? '❌ ' + bad + ' problem' + (bad === 1 ? '' : 's') + ' to fix' : warn ? '✅ Ready (' + warn + ' note' + (warn === 1 ? '' : 's') + ')' : '✅ All good';
  return top + '\n\n' + h.map((x) => icon[x.s] + ' ' + x.t + (x.s !== 'ok' && x.fix ? (plain ? '\n     → ' : ' → ') + x.fix : '')).join('\n');
}
function adminHealth() { withUi_(() => healthText_(health_(cfg_()), true)); }
// Runs by itself once, a few hours before sign-ups close; problems go to the private log channel.
function autoHealth_(C) {
  const h = health_(C), issues = h.filter((x) => x.s !== 'ok');
  log_('system', issues.some((x) => x.s === 'bad') ? 'Health check: needs you' : 'Health check', issues.length ? issues.map((x) => (x.s === 'bad' ? '❌ ' : '⚠️ ') + x.t + ' → ' + x.fix).join(' | ') : 'All good for the ' + norm_(C.TOURNEY_NAME));
}


// ===================== ⛳ Two Man Scramble (FORMAT = scramble) =====================
// Single elimination between two-club teams. Partners: name one on the form, or get drawn at random at sign-up close.
// A match is four BigLeague games, every club against both clubs on the other team:
//   Front nine: A1 v B1, A2 v B2        Back nine: A1 v B2, A2 v B1
// Scored as a Nassau (golf's classic three-part bet), from final scores only:
//   Front 9 = the better of your two clubs' runs in the front-nine games (best ball)
//   Back 9  = the same for the back nine
//   Overall = all your runs in all four games
// One point each (a tie halves it). Most points wins; still level: the biggest single game ("longest drive"), then the higher seed.
// Each team tees off (starts the game) once on the front nine and once on the back nine.
const TEAM0_ = 1e9;                                 // team IDs live far above any club ID
const isScr_ = (C) => lc_((C || cfg_()).FORMAT) === 'scramble';
const isTeam_ = (id) => Number(id) >= TEAM0_;
const SCR_GAMES_ = [   // which club of each team plays, and which team tees off
  { k: 'F1', nine: 'Front', a: 0, b: 0, tee: 'A' },
  { k: 'F2', nine: 'Front', a: 1, b: 1, tee: 'B' },
  { k: 'K1', nine: 'Back', a: 0, b: 1, tee: 'B' },
  { k: 'K2', nine: 'Back', a: 1, b: 0, tee: 'A' },
];
const teamOf_ = (T, id) => (T && T.teams ? T.teams[String(id)] : null);
const teamName_ = (E, tm) => tm.clubs.map((c) => (E[c] ? norm_(E[c].Discord) : String(c))).join(' & ');
const teamClubs_ = (E, tm) => tm.clubs.map((c) => (E[c] ? norm_(E[c].Club) : 'Club ' + c)).join(' + ');

// The partner box on the form (added once, when a tournament is a scramble).
function ensurePartnerItem_(C) {
  if (!norm_(C.FORM_ID)) return;
  const pr = props_(); if (pr.getProperty('PARTNER_ITEM') === norm_(C.FORM_ID)) return;
  try {
    const f = FormApp.openById(norm_(C.FORM_ID)), has = f.getItems().some((it) => norm_(it.getTitle()).indexOf('Partner') === 0);
    if (!has) f.addTextItem().setTitle(Q.PARTNER).setHelpText('Got a partner in mind? Their Discord name or club ID. They sign up too. Leave it blank to be drawn a partner at random.');
    pr.setProperty('PARTNER_ITEM', norm_(C.FORM_ID));
  } catch (e) { log_('system', 'Partner box not added', String(e.message || e)); }
}
function ensureCol_(name, col) {
  const sh = sheet_(name, name === SHEETS.ENTRANTS ? ENTRANT_COLS : null), head = sh.getDataRange().getValues()[0].map(norm_);
  if (head.indexOf(col) < 0) sh.getRange(1, head.filter(Boolean).length + 1).setValue(col);
}

// Sign-ups close: make the teams, then a single-elimination bracket between them (random seeds: it's a scramble).
function drawScramble_(C, E) {
  const pr = props_(), list = E.slice().sort((a, b) => new Date(a.Joined) - new Date(b.Joined));
  if (list.length < 4) {
    if (!pr.getProperty('TOO_FEW_POSTED')) { pr.setProperty('TOO_FEW_POSTED', '1');
      post_('😬 Only ' + list.length + ' club' + (list.length === 1 ? '' : 's') + ' signed up for the **' + esc_(C.TOURNEY_NAME) + '**: a scramble needs at least 4 (two teams). Sign-ups stay open, and the teams are drawn as soon as there are 4.' + linksLine_(C)); }
    return null;
  }
  const key = (r) => [lc_(r.Discord), lc_(r.Owner), lc_(r.Club), norm_(r.ClubID)].filter(Boolean);
  const want = (r) => { const p = lc_(r.Partner).replace(/^@/, ''); if (!p) return null; return list.find((o) => o !== r && key(o).indexOf(p) >= 0) || null; };
  const paired = new Map(), teams = [];
  const pair = (x, y, how) => { paired.set(x, y); paired.set(y, x); teams.push({ rows: [x, y], how }); };
  list.forEach((r) => { const w = want(r); if (w && !paired.has(r) && !paired.has(w) && want(w) === r) pair(r, w, 'picked'); });        // asked each other
  list.forEach((r) => { const w = want(r); if (w && !paired.has(r) && !paired.has(w) && !want(w)) pair(r, w, 'picked'); });            // asked someone who asked nobody
  let rest = list.filter((r) => !paired.has(r)), alt = null;
  if (rest.length % 2) { alt = rest[rest.length - 1]; rest = rest.slice(0, -1); }                                                   // the last sign-up waits
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = rest[i]; rest[i] = rest[j]; rest[j] = x; }
  for (let i = 0; i + 1 < rest.length; i += 2) pair(rest[i], rest[i + 1], 'drawn');
  // Random seeds, then the bracket.
  for (let i = teams.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const x = teams[i]; teams[i] = teams[j]; teams[j] = x; }
  const T = { fmt: 'scramble', teams: {}, seeds: [], created: Date.now(), wave: 0, matches: [], final: null, alt: alt ? Number(alt.ClubID) : null };
  teams.forEach((tm, i) => { const id = TEAM0_ + i + 1; T.teams[String(id)] = { id, clubs: tm.rows.map((r) => Number(r.ClubID)), how: tm.how }; T.seeds.push({ club: id, seed: i + 1 }); });
  Object.assign(T, buildSingle_(T.seeds.map((s) => s.club), {}));
  settle_(T);
  return T;
}

// Waves for a scramble: each match opens with its four tee times.
function scrLine_(T, m, E) {
  const a = teamOf_(T, sideClub_(T, m.a)), b = teamOf_(T, sideClub_(T, m.b));
  m.games = m.games || SCR_GAMES_.map((g) => { const ca = a.clubs[g.a], cb = b.clubs[g.b]; return { k: g.k, nine: g.nine, a: ca, b: cb, tee: g.tee === 'A' ? ca : cb }; });
  const who = (c) => tag_(E[c]) + ' (*' + esc_(E[c] ? E[c].Club : c) + '*)';
  const g = (x) => { const other = x.tee === x.a ? x.b : x.a;
    return '> • ' + who(x.tee) + ' **tees off** vs ' + esc_(E[other] ? E[other].Club : other) + ' `' + other + '` · 👉 [Start it](<https://play.smallball.com/?sbx_as=' + x.tee + '#/team/' + other + '>)'; };
  const card = boardUrl_(cfg_()) ? ' · 🔎 [Matchup card](<' + boardUrl_(cfg_()) + '#m=' + m.id + '>)' : '';
  return '⛳ **' + esc_(m.label) + '** · all four games by ' + ts_(m.deadline) + ' (' + tsR_(m.deadline) + ')\n> 🏌️ **Team ' + esc_(teamName_(E, a)) + '** vs **Team ' + esc_(teamName_(E, b)) + '**' + card + '\n' +
    '> **Front nine**\n' + m.games.filter((x) => x.nine === 'Front').map(g).join('\n') + '\n> **Back nine**\n' + m.games.filter((x) => x.nine === 'Back').map(g).join('\n');
}

// Find each of the four games. Two look-ups per match cover all four (each club of team A is in two of them).
function scrDetect_(T, C) {
  const open = T.matches.filter((m) => m.openAt && !m.winner && !m.void && !m.flag && m.games);
  if (!open.length) return false;
  const kinds = norm_(C.ALLOWED_KINDS || 'big').split(',').map(lc_).filter(String), E = entrantMap_(), used = {};
  T.matches.forEach((m) => (m.games || []).forEach((g) => { if (g.gid) used[g.gid] = 1; }));
  let changed = false;
  for (const m of open) {
    const cache = {};
    for (const g of m.games) {
      if (g.gid) continue;
      let rows = cache[g.a]; if (!rows) { try { rows = cache[g.a] = clubGames_(g.a); } catch (e) { log_('system', 'SmallBall error', String(e.message || e)); continue; } }
      const hit = rows.filter((x) => { const ft = Date.parse(x.finished_at), ids = [String(x.away_team_id), String(x.home_team_id)];
        return ids.indexOf(String(g.a)) >= 0 && ids.indexOf(String(g.b)) >= 0 && kinds.indexOf(lc_(x.kind)) >= 0 && ft >= m.openAt - 120000 && ft <= m.deadline && !used[String(x.game_id)] && x.away_runs != null; })
        .sort((x, y) => Date.parse(x.finished_at) - Date.parse(y.finished_at))[0];
      if (!hit) continue;
      const aAway = String(hit.away_team_id) === String(g.a);
      g.gid = String(hit.game_id); g.ra = Number(aAway ? hit.away_runs : hit.home_runs); g.rb = Number(aAway ? hit.home_runs : hit.away_runs);
      g.airs = Date.parse(hit.finished_at) + Math.max(0, Number(C.POST_DELAY_MINUTES) || 0) * 60000; used[g.gid] = 1;
      log_('system', 'Game found', m.id + ' ' + g.k + ' game ' + g.gid);
      post_('📡 **' + (g.nine === 'Front' ? 'Front' : 'Back') + ' nine** game found in ' + esc_(m.label) + ': ' + esc_(plainName_(E, g.a)) + ' vs ' + esc_(plainName_(E, g.b)) + ' · game `' + g.gid + '`. Scores post when all four games have aired. (No spoilers.)\n📺 Watch it: <' + watchUrl_(g.gid) + '>');
      changed = true;
    }
  }
  return changed;
}
// The Nassau, from whichever games were played.
function nassau_(m) {
  const G = {}; (m.games || []).forEach((g) => { G[g.k] = g; });
  const r = (k, side) => (G[k] && G[k].gid ? (side === 'a' ? G[k].ra : G[k].rb) : null);
  const best = (x, y) => (x == null && y == null ? 0 : Math.max(x == null ? -1 : x, y == null ? -1 : y));
  // Team A is "a" in every game; team B is "b".
  const f = [best(r('F1', 'a'), r('F2', 'a')), best(r('F1', 'b'), r('F2', 'b'))];
  const k = [best(r('K1', 'a'), r('K2', 'a')), best(r('K1', 'b'), r('K2', 'b'))];
  const sum = (side) => ['F1', 'F2', 'K1', 'K2'].reduce((s, x) => s + (r(x, side) || 0), 0);
  const t = [sum('a'), sum('b')];
  const pt = (p) => (p[0] > p[1] ? [1, 0] : p[0] < p[1] ? [0, 1] : [0.5, 0.5]);
  const P = [f, k, t].map(pt), p = [P[0][0] + P[1][0] + P[2][0], P[0][1] + P[1][1] + P[2][1]];
  const big = (side) => Math.max.apply(null, [0].concat(['F1', 'F2', 'K1', 'K2'].map((x) => r(x, side) || 0)));
  return { f, k, t, p, drive: [big('a'), big('b')], played: (m.games || []).filter((g) => g.gid).length };
}
// Score a match once all four games have aired (or, at the deadline, with the games that were played).
function scrPostDue_(T, C, atDeadline) {
  const t = Date.now(), E = entrantMap_();
  let changed = false;
  for (const m of T.matches) {
    if (!m.openAt || m.winner || m.void || m.flag || !m.games) continue;
    const found = m.games.filter((g) => g.gid), airing = found.some((g) => g.airs > t);
    if (airing) continue;
    if (found.length < 4 && !(atDeadline && t >= m.deadline)) continue;
    const a = sideClub_(T, m.a), b = sideClub_(T, m.b);
    if (!found.length) {
      if (lc_(C.NO_SHOW) === 'commish') { m.flag = true; post_('⏰ **' + esc_(m.label) + '**: no games were played. The organizer will decide.'); changed = true; continue; }
      finish_(T, m, seedOf_(T, a) < seedOf_(T, b) ? a : b, null, 'no-show');
      post_(scrResultText_(T, m, E, C, '⏰ Nobody teed off before the deadline, so the higher seed moves on.')); changed = true; continue;
    }
    const n = nassau_(m); let w, how = '', mp = null, why = '';
    if (lc_(C.SCRAMBLE_SCORING || 'holes') !== 'nassau') {
      why = readLines_(m);
      // SmallBall having a bad minute: try again on the next tick (for up to half an hour past the deadline).
      if (why && !/expired|no login|no box score/.test(why) && t < Math.max(m.deadline, Math.max.apply(null, found.map((g) => g.airs))) + 30 * 60000) continue;
      if (!why) mp = holes_(m);
    }
    m.nassau = n;
    if (mp) {
      m.mp = mp;
      if (mp.lead) { w = mp.lead === 'a' ? a : b; how = mp.tieBy; }
      else if (n.drive[0] !== n.drive[1]) { w = n.drive[0] > n.drive[1] ? a : b; how = 'longest drive'; }
      else { w = seedOf_(T, a) < seedOf_(T, b) ? a : b; how = 'higher seed'; }
      finish_(T, m, w, null, how); m.score = [mp.res];
    } else {
      if (n.p[0] !== n.p[1]) w = n.p[0] > n.p[1] ? a : b;
      else if (n.drive[0] !== n.drive[1]) { w = n.drive[0] > n.drive[1] ? a : b; how = 'longest drive'; }
      else { w = seedOf_(T, a) < seedOf_(T, b) ? a : b; how = 'higher seed'; }
      finish_(T, m, w, null, how);
      m.score = w === a ? [n.p[0], n.p[1]] : [n.p[1], n.p[0]];
    }
    const notes = [];
    if (found.length < 4) notes.push('⏰ ' + (4 - found.length) + ' of the four games weren\'t played before the deadline; they count for nothing.');
    if (!mp && why) { notes.push('📋 Box scores weren\'t available (' + why + '), so this one is scored as a Nassau.'); log_('system', 'Scored as a Nassau', m.id + ': ' + why); }
    post_(scrResultText_(T, m, E, C, notes.join('\n')));
    changed = true;
  }
  return changed;
}
const half_ = (x) => (x % 1 ? (Math.floor(x) ? Math.floor(x) : '') + '½' : String(x));
function scrResultText_(T, m, E, C, note) {
  const a = sideClub_(T, m.a), b = sideClub_(T, m.b), A = teamOf_(T, a), B = teamOf_(T, b), w = m.winner, n = m.nassau;
  const W = w === a ? A : B, L = w === a ? B : A;
  let s = '⛳ **' + esc_(m.label) + '**: Team ' + W.clubs.map((c) => tag_(E[c])).join(' & ') + ' beats Team ' + esc_(teamName_(E, L));
  const mp = m.mp;
  if (mp) {
    const cw = w === a ? mp.ca : mp.cb, cl = w === a ? mp.cb : mp.ca;
    const line = (nm, c) => '`' + (nm + '              ').slice(0, 14) + ' ' + (toPar_(c.par) + '   ').slice(0, 4) + '` OUT ' + toPar_(c.out) + ' · IN ' + toPar_(c.inn) + (c.bird + c.eagle + c.alb ? ' · ' + [c.bird && c.bird + ' birdie' + (c.bird > 1 ? 's' : ''), c.eagle && c.eagle + ' eagle' + (c.eagle > 1 ? 's' : ''), c.alb && c.alb + ' albatross' + (c.alb > 1 ? 'es' : '')].filter(Boolean).join(', ') : '');
    s += ' **' + (mp.res === 'AS' ? 'all square after 18, wins on ' + (m.how === 'to par' ? 'total score' : m.how || 'the tiebreak') : mp.res) + '** in match play.\n' + line(teamName_(E, W).slice(0, 14), cw) + '\n' + line(teamName_(E, L).slice(0, 14), cl) +
      (boardUrl_(C) ? '\n📋 [Full scorecard](<' + boardUrl_(C) + '#m=' + m.id + '>)' : '') + '\n-# Games: ' + m.games.filter((g) => g.gid).map((g) => '`' + g.gid + '`').join(' ');
  } else if (n) {
    const row = (lab, p) => '`' + (lab + '         ').slice(0, 9) + '` ' + (w === a ? p[0] + '–' + p[1] : p[1] + '–' + p[0]);
    s += ' **' + half_(m.score[0]) + '–' + half_(m.score[1]) + '** on the Nassau' + (m.how ? ' (' + m.how + ')' : '') + '.\n' +
      row('Front 9', n.f) + (n.f[0] === n.f[1] ? ' · halved' : '') + '\n' + row('Back 9', n.k) + (n.k[0] === n.k[1] ? ' · halved' : '') + '\n' + row('Overall', n.t) + (n.t[0] === n.t[1] ? ' · halved' : '') +
      '\n-# Games: ' + m.games.filter((g) => g.gid).map((g) => '`' + g.gid + '`').join(' ');
  } else s += (m.how ? ' (' + m.how + ')' : '') + '.';
  if (note) s += '\n' + note;
  const next = T.matches.find((x) => !x.winner && !x.void && (sideClub_(T, x.a) === w || sideClub_(T, x.b) === w));
  if (next && !champion_(T)) s += '\n➡️ They play next in the **' + esc_(next.label) + '**, which opens as soon as their opponents are known.';
  return s + linksLine_(C);
}
function scrCrown_(T, C) {
  const E = entrantMap_(), c = champion_(T), tm = teamOf_(T, c); T.done = Date.now();
  const f = T.matches.find((m) => m.id === T.final); T.runner = f ? f.loser : null;
  const R = teamOf_(T, T.runner);
  post_('# 🏆 Team ' + esc_(teamName_(E, tm)) + ' wins the ' + esc_(C.TOURNEY_NAME) + '!\n' + tm.clubs.map((x) => tag_(E[x]) + ' (*' + esc_(E[x] ? E[x].Club : x) + '*)').join(' & ') + ' take the trophy. ⛳🎉' +
    (R ? '\n🥈 Runner-up: Team ' + esc_(teamName_(E, R)) : '') + (norm_(C.PRIZES) ? '\n🎁 Prizes: ' + esc_(C.PRIZES) : '') + '\nThanks for playing, everybody! See you next Sunday. 🐶' + linksLine_(C));
  log_('system', 'Champion', String(c));
}
// The bracket-drawn post for a scramble.
function scrDrawPost_(T, C) {
  const E = entrantMap_(), start = when_(C.START, C);
  const lines = T.seeds.map((s) => { const tm = teamOf_(T, s.club); return s.seed + '. Team ' + tm.clubs.map((c) => tag_(E[c])).join(' & ') + ' · ' + teamClubs_(E, tm) + (tm.how === 'picked' ? ' 🤝' : ' 🎲'); });
  post_('# ⛳ The ' + esc_(C.TOURNEY_NAME) + ' teams are set!\n**' + T.seeds.length + ' two-man teams · single elimination · 18 holes of match play**\n\n' + lines.join('\n') + '\n-# 🤝 picked their partner · 🎲 drawn at random' +
    (T.alt ? '\n\n🪑 ' + tag_(E[T.alt]) + ' is the alternate this week (odd number of clubs): first in line if anyone drops, and first in next week.' : '') +
    '\n\n**How a match works**\n> Every club plays both clubs on the other team: four BigLeague games. Each team tees off (starts the game) once on the front nine and once on the back.\n' +
    '> **18 holes of match play:** holes 1–9 are the innings of your front-nine games, 10–18 your back nine. Each hole, your team takes its **better inning** of your two clubs; more runs wins the hole. Most holes wins (*3 & 2* = 3 up with 2 to play).\n' +
    '> 🐦 birdie = 1 run · 🦅 eagle = 2 · albatross = 3+. Scores post once all four games have aired: no spoilers.\n\n' +
    '🔔 First tee time: ' + ts_(start) + ' (' + tsR_(start) + '). Your next match opens the moment your opponents are known.' + linksLine_(C));
}

const GOLF_HTML_ = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3CradialGradient id='g' cx='36%' cy='30%' r='72%'%3E%3Cstop offset='0' stop-color='%23ffffff'/%3E%3Cstop offset='.65' stop-color='%23edf0f2'/%3E%3Cstop offset='1' stop-color='%23aeb7be'/%3E%3C/radialGradient%3E%3C/defs%3E%3Ccircle cx='32' cy='32' r='29' fill='url(%23g)' stroke='%237d8890' stroke-width='2.5'/%3E%3Ccircle cx='24' cy='20' r='2.6' fill='%23c3cbd1'/%3E%3Ccircle cx='34' cy='16' r='2.6' fill='%23c3cbd1'/%3E%3Ccircle cx='44' cy='22' r='2.6' fill='%23c3cbd1'/%3E%3Ccircle cx='18' cy='30' r='2.6' fill='%23c3cbd1'/%3E%3Ccircle cx='29' cy='28' r='2.6' fill='%23c3cbd1'/%3E%3Ccircle cx='40' cy='31' r='2.6' fill='%23c3cbd1'/%3E%3Ccircle cx='50' cy='33' r='2.6' fill='%23c3cbd1'/%3E%3Ccircle cx='22' cy='41' r='2.6' fill='%23c3cbd1'/%3E%3Ccircle cx='33' cy='39' r='2.6' fill='%23c3cbd1'/%3E%3Ccircle cx='44' cy='43' r='2.6' fill='%23c3cbd1'/%3E%3Ccircle cx='28' cy='50' r='2.6' fill='%23c3cbd1'/%3E%3Ccircle cx='39' cy='52' r='2.6' fill='%23c3cbd1'/%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,800;1,600&family=IBM+Plex+Mono:wght@500;700&display=swap" rel="stylesheet">
<style>
:root{--turf:#1f5a36;--turf2:#24653d;--deep:#0c3322;--cream:#f7f2e4;--paper:#fffdf6;--ink:#1d2a22;--muted:#5e6b62;--sand:#e8d6a6;--flag:#c8102e;--gold:#c9a227;--line:#d9d0b8}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:var(--turf);
 background-image:repeating-linear-gradient(90deg,rgba(255,255,255,.045) 0 70px,rgba(0,0,0,.035) 70px 140px),radial-gradient(ellipse at 50% -10%,rgba(255,255,255,.12),transparent 60%);min-height:100vh}
a{color:inherit}
.wrap{max-width:1200px;margin:0 auto;padding:18px 14px 40px}
.home{display:inline-block;color:var(--sand);font:600 13px/1 system-ui,sans-serif;text-decoration:none;margin:0 0 10px;opacity:.95}.home:hover{text-decoration:underline}
header{background:linear-gradient(180deg,#0f3d29,var(--deep));color:var(--cream);border-radius:18px;padding:20px 24px;display:flex;flex-wrap:wrap;gap:14px 28px;align-items:center;justify-content:space-between;
 box-shadow:0 14px 34px rgba(0,0,0,.35),inset 0 0 0 2px rgba(201,162,39,.45),inset 0 0 0 6px var(--deep),inset 0 0 0 7px rgba(201,162,39,.25);position:relative;overflow:hidden}
header:after{content:"";position:absolute;right:-30px;bottom:-60px;width:220px;height:140px;border-radius:50%;background:radial-gradient(ellipse,rgba(232,214,166,.18),transparent 70%)}
.kick{font:700 12px/1 system-ui,sans-serif;letter-spacing:3px;color:var(--gold);text-transform:uppercase}
h1{font:800 clamp(30px,6vw,52px)/1.02 'Playfair Display',Georgia,serif;margin:6px 0 4px;letter-spacing:.3px}
.sub{color:#cfe0d2;font-size:14px}
.meta{text-align:right;color:#dfe9df;font-size:14px;position:relative;z-index:1}.meta b{color:#fff}
.btn{display:inline-block;margin-top:8px;text-decoration:none;font:700 14px system-ui,sans-serif;border-radius:999px;padding:9px 16px;background:var(--sand);color:#2b2410;border:0;cursor:pointer}
.btn.flag{background:var(--flag);color:#fff}
h2{font:700 26px/1.1 'Playfair Display',Georgia,serif;color:var(--cream);margin:28px 0 12px;display:flex;align-items:center;gap:10px;text-shadow:0 2px 0 rgba(0,0,0,.25)}
h2 small{font:600 12px system-ui,sans-serif;background:rgba(0,0,0,.25);color:var(--sand);padding:3px 10px;border-radius:999px;letter-spacing:.5px}
.card{background:var(--paper);border-radius:12px;box-shadow:0 8px 22px rgba(0,0,0,.25);border:1px solid #efe6cf}
.champ{margin:18px 0 0;padding:18px 20px;border-radius:14px;background:linear-gradient(135deg,#fff8dc,#f2e2a8);color:#3b2f08;font:700 24px/1.2 'Playfair Display',Georgia,serif;box-shadow:0 10px 26px rgba(0,0,0,.3);display:flex;gap:14px;align-items:center}
.champ .t{font-size:40px}.champ small{display:block;font:500 14px system-ui,sans-serif;color:#6b5a1a;margin-top:4px}
/* tee sheet */
.tee{padding:6px 0;background-image:repeating-linear-gradient(180deg,transparent 0 37px,#eadfc3 37px 38px)}
.tee .row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:8px 16px;min-height:38px}
.tee .n{font:700 13px 'IBM Plex Mono',monospace;color:var(--muted);width:26px}
.tee .who{font-weight:700}.tee .club{color:var(--muted)}
.cid{display:inline-block;font:700 13px 'IBM Plex Mono',monospace;background:var(--sand);color:#3a2d06;border-radius:6px;padding:2px 7px;text-decoration:none}
.cid:hover{filter:brightness(.95)}
.pr{font-size:12px;background:#e6f1e8;color:#1f5a36;border-radius:999px;padding:2px 8px}
.note{color:var(--muted);font-size:13px;padding:10px 16px 14px}
/* bracket */
.rounds{display:flex;gap:18px;overflow-x:auto;padding:4px 2px 12px;align-items:stretch}
.col{min-width:300px;flex:1;display:flex;flex-direction:column}
.col h3{font:600 italic 18px 'Playfair Display',Georgia,serif;color:var(--cream);margin:0 0 10px;text-align:center}
.col .list{display:flex;flex-direction:column;justify-content:space-around;flex:1;gap:16px}
.sc{background:var(--paper);border-radius:10px;overflow:hidden;box-shadow:0 6px 18px rgba(0,0,0,.25);border:1px solid #ece2c8}
.sc.live{box-shadow:0 0 0 3px rgba(200,16,46,.55),0 6px 18px rgba(0,0,0,.25)}
.sc .hd{display:flex;justify-content:space-between;align-items:center;background:var(--deep);color:var(--cream);font:600 12px system-ui,sans-serif;padding:7px 10px;letter-spacing:.3px}
.sc .hd .st{color:var(--sand)}.sc.live .hd .st{color:#ffb3bf}
table{width:100%;border-collapse:collapse;font-size:14px}
th{font:700 10px system-ui,sans-serif;letter-spacing:1px;text-transform:uppercase;color:var(--muted);text-align:center;padding:5px 4px;border-bottom:1px solid var(--line);background:#f8f3e3}
th:first-child{text-align:left;padding-left:10px}
td{padding:7px 4px;border-bottom:1px solid #efe7d2;text-align:center;font:700 15px 'IBM Plex Mono',monospace;color:#2c3a30}
td.tm{text-align:left;padding-left:10px;font:600 14px system-ui,sans-serif;color:var(--ink);line-height:1.25}
td.tm .cl{display:block;font:500 12px system-ui,sans-serif;color:var(--muted);margin-top:2px}
td.tm .cl a{margin-right:4px}
tr.w td{background:#eef6ef}tr.w td.tm{font-weight:800}tr.w td.pt{color:var(--flag)}
tr:last-child td{border-bottom:0}
td.pt{font-size:17px}
.seed{display:inline-block;min-width:20px;text-align:center;font:700 11px 'IBM Plex Mono',monospace;color:#fff;background:var(--turf);border-radius:4px;padding:1px 4px;margin-right:5px}
.tbd{color:#9aa39c;font-style:italic;font-weight:500}
.games{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px;border-top:1px dashed var(--line);background:#fbf8ee}
.g{font:600 11px system-ui,sans-serif;border-radius:999px;padding:3px 8px;background:#efe9d6;color:#5b5236;white-space:nowrap}
.g.f{background:#ffe8ec;color:#8a0f22}.g.d{background:#e2f0e5;color:#1f5a36}
.g a{text-decoration:none}
.foot{font:500 12px system-ui,sans-serif;color:var(--muted);padding:6px 10px 9px}
.foot b{color:var(--ink)}
/* rules */
details.rules{margin-top:14px}
details.rules summary{cursor:pointer;list-style:none;color:var(--cream);font:700 18px 'Playfair Display',Georgia,serif}
details.rules summary::-webkit-details-marker{display:none}
.rulebox{padding:16px 18px;margin-top:10px}
.rulebox h4{margin:12px 0 4px;font:700 15px 'Playfair Display',Georgia,serif;color:var(--deep)}
.rulebox p,.rulebox li{margin:4px 0;color:#2f3b33}
.nas{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:10px 0}
.nas div{background:#f3ecd7;border-radius:10px;padding:10px;text-align:center}
.nas b{display:block;font:800 18px 'Playfair Display',Georgia,serif;color:var(--deep)}
.nas span{font-size:12px;color:var(--muted)}
.pair{font:600 13px 'IBM Plex Mono',monospace;background:#f3ecd7;border-radius:8px;padding:8px 10px;margin:6px 0}
.empty{color:var(--cream);opacity:.9;padding:12px 0}
.upd{color:#cfe0d2;font-size:12px;text-align:center;margin-top:20px}
.sc.tap{cursor:pointer}.sc.tap:hover{transform:translateY(-1px);box-shadow:0 10px 24px rgba(0,0,0,.3)}
.mu{font:600 11px system-ui,sans-serif;color:var(--sand);text-decoration:none;margin-left:8px;opacity:.9}
.ov{position:fixed;inset:0;background:rgba(6,24,15,.78);z-index:20;overflow:auto;padding:18px 10px;display:flex;flex-direction:column;align-items:center}
.ov .bar{display:flex;gap:10px;margin:0 0 12px;flex-wrap:wrap;justify-content:center}
.mc{width:min(900px,100%);background:var(--paper);border-radius:18px;overflow:hidden;box-shadow:0 16px 40px rgba(0,0,0,.4)}
.mc .top{background:linear-gradient(180deg,#0f3d29,var(--deep));color:var(--cream);padding:14px 20px;display:flex;justify-content:space-between;align-items:center;gap:10px}
.mc .top .k{font:700 11px system-ui,sans-serif;letter-spacing:2.5px;color:var(--gold);text-transform:uppercase}
.mc .top h3{margin:4px 0 0;font:800 24px 'Playfair Display',Georgia,serif}
.mc .top .t{text-align:right;font-size:13px;color:#dfe9df}.mc .top .t b{display:block;color:#fff;font-size:16px}
.mc .vs{display:grid;grid-template-columns:1fr 70px 1fr;align-items:center;padding:16px 20px 4px;gap:8px}
.mc .team h4{margin:0 0 6px;font:800 22px/1.15 'Playfair Display',Georgia,serif;color:var(--deep)}.mc .team.r{text-align:right}
.mc .club{margin-top:4px;font-size:14px}.mc .club b{font:700 12px 'IBM Plex Mono',monospace;color:var(--muted)}
.mc .mid{text-align:center;font:italic 700 28px 'Playfair Display',Georgia,serif;color:var(--gold)}
.mc .course{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:12px 20px 16px}
.mc .nine{border-radius:14px;padding:12px 14px;background:linear-gradient(180deg,#2c7a46,#23663a);color:#fff;position:relative;overflow:hidden}
.mc .nine:before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(100deg,rgba(255,255,255,.06) 0 26px,transparent 26px 52px)}
.mc .nine h5{position:relative;margin:0 0 8px;font:700 italic 18px 'Playfair Display',Georgia,serif;color:var(--sand)}
.mc .pair{position:relative;display:grid;grid-template-columns:1fr 34px 1fr;align-items:center;background:rgba(0,0,0,.2);border-radius:14px;padding:8px 12px;margin:7px 0;font:700 14px/1.2 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.2}
.mc .pair .b{text-align:right}.mc .pair small{display:block;font:600 11px 'IBM Plex Mono',monospace;color:#cfe6d4}
.mc .pair .fl{text-align:center;font-size:18px}
.mc .tee{display:inline-block;background:var(--flag);color:#fff;font:700 9px system-ui,sans-serif;letter-spacing:.5px;border-radius:999px;padding:2px 6px;margin:2px 0 0;vertical-align:1px}
.mc .gs{display:block;font:600 10px system-ui,sans-serif;color:#ffe6a6;margin-top:3px}
.mc .score{display:grid;grid-template-columns:repeat(4,1fr);border-top:2px dashed #e2d7ba;margin:0 20px;padding:12px 0 14px;text-align:center}
.mc .score div{font:700 11px system-ui,sans-serif;letter-spacing:1px;color:var(--muted);text-transform:uppercase}
.mc .score b{display:block;font:700 24px 'IBM Plex Mono',monospace;color:var(--ink);letter-spacing:0;margin-top:2px}
.mc .score .p b{color:var(--flag)}
.mc .foot{background:#f3ecd7;color:var(--muted);font-size:12px;padding:9px 20px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
.ov img.shot{max-width:min(900px,100%);border-radius:12px;margin-top:12px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
.ov .hint{color:var(--cream);font-size:13px;margin-top:8px;text-align:center}
@media(max-width:640px){.mc .course{grid-template-columns:1fr}.mc .vs{grid-template-columns:1fr;text-align:center}.mc .team.r{text-align:center}.mc .score b{font-size:19px}}
.c18{width:100%;border-collapse:collapse;font:600 13px 'IBM Plex Mono',monospace;margin:4px 0}
.c18 th{font:700 10px system-ui,sans-serif;color:var(--muted);background:#f3ecd7;padding:5px 2px;text-align:center;border:1px solid #e6dcc0;letter-spacing:.5px}
.c18 td{padding:4px 2px;text-align:center;border:1px solid #efe7d2;color:#2c3a30;font:700 13px 'IBM Plex Mono',monospace}
.c18 td.nm{text-align:left;padding-left:8px;font:700 12px system-ui,sans-serif;white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis}
.c18 td.sum{background:#f8f3e3;color:var(--deep)}
.c18 .r{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%}
.c18 .b1{box-shadow:0 0 0 1.5px var(--flag)}
.c18 .b2{box-shadow:0 0 0 1.5px var(--flag),0 0 0 3px #fff,0 0 0 4.5px var(--flag)}
.c18 .b3{background:var(--flag);color:#fff}
.c18 .par{color:#a7ae9f}
.c18 tr.ms td{font:700 9px system-ui,sans-serif;color:var(--muted);background:#fbf8ee;padding:3px 1px}
.c18 tr.ms td.ua{color:#1f5a36}.c18 tr.ms td.ub{color:#8a5a00}
.c18 td.cl{background:#fff3c4}
.res18{text-align:center;font:700 italic 20px 'Playfair Display',Georgia,serif;color:var(--deep);padding:6px 0 2px}
.legend{font:500 11px system-ui,sans-serif;color:var(--muted);text-align:center;padding:2px 0 8px}
.wrap18{overflow-x:auto;padding:4px 20px 8px}
@media(max-width:640px){header{padding:16px}.meta{text-align:left}.col{min-width:84vw}.nas{grid-template-columns:1fr}}
</style></head><body><div class="wrap" id="app"></div>
<script>
var D=__DATA__;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function t(ms){return ms?new Date(ms).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):''}
function tp(n){return n===0?'E':n>0?'+'+n:'−'+(-n)}
function hf(x){if(x==null)return'';var w=Math.floor(x);return x%1?(w?w:'')+'½':String(x)}
function cid(c){return '<a class="cid" href="https://play.smallball.com/#/team/'+esc(c.id)+'" target="_blank">'+esc(c.id)+'</a>'}
var HOME=location.host.slice(-9)==='github.io'?location.pathname.split('/').slice(0,2).join('/')+'/tournaments/':'https://slipnsliders.github.io/smallball-tools/tournaments/';
function teamCell(x,seedOn){
  if(!x)return '<td class="tm"><span class="tbd">Winner of the last match</span></td>';
  var cl=(x.clubs||[]).map(function(c){return esc(c.n)+' '+cid(c)}).join(' · ');
  return '<td class="tm">'+(seedOn&&x.s?'<span class="seed">'+x.s+'</span>':'')+esc(x.n)+'<span class="cl">'+cl+'</span></td>'}
function mpCard(m,tap){
  var M=m.mp,aw=m.a&&m.w===m.a.id;
  var h='<div class="sc tap" data-m="'+esc(m.id)+'"><div class="hd"><span>'+esc(m.l)+'<span class="mu">🔎 Scorecard</span></span><span class="st">Final · '+esc(M.res==='AS'?'AS, '+(m.how==='to par'?'on total':m.how):M.res)+'</span></div><table><tr><th>Team</th><th>Out</th><th>In</th><th>Tot</th><th></th></tr>';
  function row(x,c,won){return '<tr'+(won?' class="w"':'')+'>'+teamCell(x,true)+'<td>'+tp(c.out)+'</td><td>'+tp(c.inn)+'</td><td>'+tp(c.par)+'</td><td class="pt">'+(won?'⛳ '+esc(M.res==='AS'?'AS':M.res):'')+'</td></tr>'}
  return h+row(m.a,M.ca,aw)+row(m.z,M.cb,!aw)+'</table><div class="foot">'+(function(){var b=M.ca.bird+M.cb.bird,e=M.ca.eagle+M.cb.eagle,a=M.ca.alb+M.cb.alb,o=[];if(b)o.push('🐦 '+b+' birdie'+(b>1?'s':''));if(e)o.push('🦅 '+e+' eagle'+(e>1?'s':''));if(a)o.push(a+' albatross'+(a>1?'es':''));return o.length?o.join(' · ')+' in this match':'All pars: a defensive grind'})()+'</div></div>'}
function card(m){
  var live=m.open&&!m.w, n=m.nas, aw=m.w&&m.a&&m.w===m.a.id, zw=m.w&&m.z&&m.w===m.z.id;
  var st=m.w?(m.how==='no-show'?'Walkover':'Final'+(m.how?' · '+m.how:'')):live?(m.found?m.found+' of 4 games found':'On the tee · by '+t(m.dl)):'Waiting';
  var tap=canMU(m);if(m.mp)return mpCard(m,tap);var h='<div class="sc'+(live?' live':'')+(tap?' tap':'')+'" data-m="'+esc(m.id)+'"><div class="hd"><span>'+esc(m.l)+(tap?'<span class="mu">🔎 Matchup</span>':'')+'</span><span class="st">'+esc(st)+'</span></div><table><tr><th>Team</th><th>F9</th><th>B9</th><th>Tot</th><th>Pts</th></tr>';
  function row(x,i,won){var p=n?[n.f[i],n.k[i],n.t[i],hf(n.p[i])]:['','','',''];
    return '<tr'+(won?' class="w"':'')+'>'+teamCell(x,true)+'<td>'+p[0]+'</td><td>'+p[1]+'</td><td>'+p[2]+'</td><td class="pt">'+(won?'⛳ ':'')+p[3]+'</td></tr>'}
  h+=row(m.a,0,aw)+row(m.z,1,zw)+'</table>';
  if(live&&m.games&&m.games.length){h+='<div class="games">'+m.games.map(function(g){
    var cls=g.aired?'g d':g.g?'g f':'g', ic=g.aired?'✓':g.g?'📡':'○';
    var lab=(g.nine==='Front'?'Front':'Back')+': '+esc(g.an)+' v '+esc(g.bn);
    return '<span class="'+cls+'">'+ic+' '+(g.g?'<a href="https://play.smallball.com/training?watch='+esc(g.g)+'" target="_blank">'+lab+'</a>':lab+' · '+esc(g.teen)+' tees off')+'</span>'}).join('')+'</div>'}
  if(m.w&&n&&m.how!=='no-show')h+='<div class="foot">Front <b>'+n.f.join('–')+'</b> · Back <b>'+n.k.join('–')+'</b> · Overall <b>'+n.t.join('–')+'</b></div>';
  return h+'</div>'}
function rules(){return '<details class="rules"'+(D.matches?'':' open')+'><summary>⛳ How the Two Man Scramble works ▾</summary><div class="card rulebox">'+
  '<p>Teams of two. Name a partner on the sign-up form (they sign up too), or leave it blank and get drawn a partner at random when sign-ups close. Single elimination, random seeds.</p>'+
  '<h4>A match is four games</h4><p>Every club plays both clubs on the other team, BigLeague games only:</p>'+
  '<div class="pair">Front nine: A1 v B1 · A2 v B2<br>Back nine:&nbsp; A1 v B2 · A2 v B1</div>'+
  '<p>Each team tees off (starts the game from its club) once on the front nine and once on the back. The tee times and one-click links post in Discord when your match opens.</p>'+
  '<h4>18 holes of match play</h4><p>Holes 1–9 are innings 1–9 of your front-nine games; holes 10–18 are your back-nine games. On every hole your team takes its <b>better inning</b> of your two clubs (that\u2019s the scramble). More runs wins the hole, the same halves it, and most holes won takes the match: <i>3 &amp; 2</i> means 3 up with 2 to play.</p>'+
  '<div class="nas"><div><b>Birdie</b><span>1 run on a hole</span></div><div><b>Eagle</b><span>2 runs</span></div><div><b>Albatross</b><span>3 or more</span></div></div>'+
  '<p>No runs is par. A home club that didn\u2019t need its bottom of the 9th gets a gimme (1 run). Extra innings don\u2019t count. All square after 18: the lower total score wins, then the biggest single game, then the higher seed.</p>'+
  '<p style="font-size:13px;color:#5e6b62">If the box scores can\u2019t be read, a match is scored as a Nassau instead: Front 9 and Back 9 = your better score of the two games, Overall = every run; one point each, 2 points wins.</p>'+
  '<h4>Timing</h4><p>All four games inside the match window'+(D.waveMin?' ('+D.waveMin+' minutes)':'')+'. Games not played count for nothing. Scores post once all four games have aired: no spoilers.</p></div></details>'}
var PAIRS=[{k:'F1',nine:'Front',a:0,b:0,tee:'A'},{k:'F2',nine:'Front',a:1,b:1,tee:'B'},{k:'K1',nine:'Back',a:0,b:1,tee:'B'},{k:'K2',nine:'Back',a:1,b:0,tee:'A'}];
function findM(id){return (D.matches||[]).filter(function(m){return m.id===id})[0]}
function canMU(m){return m&&m.a&&m.z&&m.a.clubs&&m.z.clubs&&!m.bye}
function muData(m){
  var A=m.a,B=m.z,G={};(m.games||[]).forEach(function(g,i){G[PAIRS[i].k]=g});
  var ps=PAIRS.map(function(p){var ca=A.clubs[p.a],cb=B.clubs[p.b],g=G[p.k];
    return{nine:p.nine,a:ca,b:cb,teeA:p.tee==='A',st:g?(g.aired?'Played':g.g?'Game found, airing':'Not played yet'):''}});
  var n=m.nas,st=m.w?(m.how==='no-show'?'Walkover':'Final'+(m.how?' ('+m.how+')':'')):m.open?'All four games by':'Tee times when both teams are set';
  return{A:A,B:B,ps:ps,n:n,head:st,when:m.open&&!m.w?t(m.dl):'',w:m.w}}
function sc18(m){
  var M=m.mp,A=m.a,B=m.z,i,h='<div class="res18">'+esc(m.w===A.id?A.n:B.n)+' win '+esc(M.res==='AS'?'(all square, on '+(m.how==='to par'?'total score':m.how)+')':M.res)+'</div><div class="wrap18"><table class="c18"><tr><th>Hole</th>';
  for(i=1;i<=18;i++){h+='<th>'+i+'</th>';if(i===9)h+='<th>Out</th>'}h+='<th>In</th><th>Tot</th></tr>';
  function cell(v,cl){var k=v==null?'':v>=3?'b3':v===2?'b2':v===1?'b1':'par';return '<td'+(cl?' class="cl"':'')+'><span class="r '+k+'">'+(v==null?'·':v===0?'–':v)+'</span></td>'}
  function row(T,x,c){var r='<tr><td class="nm">'+esc(T.n.replace(/^Team /,''))+'</td>';for(i=0;i<18;i++){r+=cell(x[i],M.clinch===i+1);if(i===8)r+='<td class="sum">'+tp(c.out)+'</td>'}return r+'<td class="sum">'+tp(c.inn)+'</td><td class="sum">'+tp(c.par)+'</td></tr>'}
  var ms='<tr class="ms"><td class="nm">Match</td>';for(i=0;i<18;i++){var d=M.run[i];ms+='<td class="'+(d>0?'ua':d<0?'ub':'')+'">'+(d?Math.abs(d)+(d>0?'▲':'▼'):'AS')+'</td>';if(i===8)ms+='<td></td>'}ms+='<td></td><td></td></tr>';
  return h+row(A,M.a,M.ca)+ms+row(B,M.b,M.cb)+'</table></div><div class="legend">Runs on each hole (your team’s better inning): ◯ birdie (1) · ◎ eagle (2) · ● albatross (3+) · – par · ▲ '+esc(A.n.replace(/^Team /,''))+' up · ▼ '+esc(B.n.replace(/^Team /,''))+' up'+(M.clinch?' · yellow = match decided':'')+'</div>'}
function openM(id){
  var m=findM(id);if(!canMU(m))return;
  if(location.hash!=='#m='+id)history.replaceState(null,'','#m='+id);
  var d=muData(m),A=d.A,B=d.B,n=d.n;
  function club(c,lab,r){return '<div class="club">'+(r?esc(c.n)+' '+cid(c)+' <b>'+lab+'</b>':'<b>'+lab+'</b> '+esc(c.n)+' '+cid(c))+'</div>'}
  function pair(p){return '<div class="pair"><div class="a">'+esc(p.a.n)+(p.teeA?' <span class="tee">TEES OFF</span>':'')+'<small>'+esc(p.a.id)+'</small></div><div class="fl">⛳</div><div class="b">'+(p.teeA?'':'<span class="tee">TEES OFF</span> ')+esc(p.b.n)+'<small>'+esc(p.b.id)+'</small></div>'+(p.st&&!n?'<span class="gs" style="grid-column:1/4;text-align:center">'+esc(p.st)+'</span>':'')+'</div>'}
  function sc(lab,v,cls){return '<div'+(cls?' class="'+cls+'"':'')+'>'+lab+'<b>'+(v?v[0]+' · '+v[1]:'– · –')+'</b></div>'}
  var h='<div class="bar"><button class="btn flag" onclick="shotM()">📷 Save image</button><button class="btn" onclick="closeM()">✕ Close</button></div>'+
   '<div class="mc" id="mc"><div class="top"><div><div class="k">⛳ '+esc(D.name||'Scramble')+'</div><h3>'+esc(m.l)+'</h3></div><div class="t">'+esc(d.head)+(d.when?'<b>'+esc(d.when)+'</b>':'')+'</div></div>'+
   '<div class="vs"><div class="team"><h4>'+(A.s?'<span class="seed">'+A.s+'</span>':'')+esc(A.n)+(d.w===A.id?' ⛳':'')+'</h4>'+club(A.clubs[0],'A1')+club(A.clubs[1],'A2')+'</div><div class="mid">vs</div>'+
   '<div class="team r"><h4>'+(d.w===B.id?'⛳ ':'')+esc(B.n)+(B.s?' <span class="seed">'+B.s+'</span>':'')+'</h4>'+club(B.clubs[0],'B1',1)+club(B.clubs[1],'B2',1)+'</div></div>'+
   '<div class="course"><div class="nine"><h5>Front nine</h5>'+d.ps.filter(function(p){return p.nine==='Front'}).map(pair).join('')+'</div><div class="nine"><h5>Back nine</h5>'+d.ps.filter(function(p){return p.nine==='Back'}).map(pair).join('')+'</div></div>'+
   (m.mp?sc18(m):'<div class="score">'+sc('Front 9',n&&n.f)+sc('Back 9',n&&n.k)+sc('Overall',n&&n.t)+sc('Points',n&&[hf(n.p[0]),hf(n.p[1])],'p')+'</div>')+
   '<div class="foot"><span>'+(m.mp?'Each hole: your team’s better inning · more runs wins the hole · birdie 1 run, eagle 2, albatross 3+':'Front 9 &amp; Back 9: better of your two games · Overall: every run · 2 points wins')+'</span><span>'+esc(location.host+location.pathname)+'</span></div></div><div id="shotbox"></div>';
  var ov=document.getElementById('ov');if(!ov){ov=document.createElement('div');ov.id='ov';ov.className='ov';ov.onclick=function(e){if(e.target===ov)closeM()};document.body.appendChild(ov)}
  ov.innerHTML=h;ov.setAttribute('data-id',id)}
function closeM(){var ov=document.getElementById('ov');if(ov)ov.remove();if(/^#m=/.test(location.hash))history.replaceState(null,'',location.pathname+location.search)}
function rr(x,X,Y,W,H,r){x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+W,Y,X+W,Y+H,r);x.arcTo(X+W,Y+H,X,Y+H,r);x.arcTo(X,Y+H,X,Y,r);x.arcTo(X,Y,X+W,Y,r);x.closePath()}
function fit(x,s,w){s=String(s);while(s.length>3&&x.measureText(s).width>w)s=s.slice(0,-2)+'…';return s}
function shotM(){
  var id=(document.getElementById('ov')||{}).getAttribute?document.getElementById('ov').getAttribute('data-id'):'',m=findM(id);if(!canMU(m))return;
  var d=muData(m),A=d.A,B=d.B,n=d.n,W=1200,H=m.mp?880:760,k=2,c=document.createElement('canvas');c.width=W*k;c.height=H*k;var x=c.getContext('2d');x.scale(k,k);
  var SERIF="'Playfair Display', Georgia, serif",SANS='system-ui, -apple-system, Segoe UI, Roboto, sans-serif',MONO="'IBM Plex Mono', monospace";
  x.fillStyle='#1f5a36';x.fillRect(0,0,W,H);for(var i=0;i<W;i+=140){x.fillStyle='rgba(255,255,255,.045)';x.fillRect(i,0,70,H)}
  rr(x,30,30,W-60,H-60,22);x.fillStyle='#fffdf6';x.fill();x.save();rr(x,30,30,W-60,H-60,22);x.clip();
  var g=x.createLinearGradient(0,30,0,130);g.addColorStop(0,'#0f3d29');g.addColorStop(1,'#0c3322');x.fillStyle=g;x.fillRect(30,30,W-60,100);
  x.fillStyle='#c9a227';x.font='700 15px '+SANS;x.fillText(('⛳ '+(D.name||'Scramble')).toUpperCase(),60,68);
  x.fillStyle='#f7f2e4';x.font='800 36px '+SERIF;x.fillText(fit(x,m.l,700),60,110);
  x.textAlign='right';x.fillStyle='#dfe9df';x.font='15px '+SANS;x.fillText(d.head,W-60,74);if(d.when){x.fillStyle='#fff';x.font='700 22px '+SANS;x.fillText(d.when,W-60,104)}x.textAlign='left';
  function team(T,X,al,labs){x.textAlign=al;x.fillStyle='#0c3322';x.font='800 32px '+SERIF;x.fillText(fit(x,(T.s?'#'+T.s+' ':'')+T.n+(d.w===T.id?' ⛳':''),470),X,180);
    x.font='18px '+SANS;T.clubs.forEach(function(cc,j){x.fillStyle='#1d2a22';x.fillText(fit(x,labs[j]+'  '+cc.n+'  ·  '+cc.id,470),X,214+j*28)});x.textAlign='left'}
  team(A,60,'left',['A1','A2']);team(B,W-60,'right',['B1','B2']);
  x.textAlign='center';x.fillStyle='#c9a227';x.font='italic 700 40px '+SERIF;x.fillText('vs',W/2,196);x.textAlign='left';
  [['Front nine',60],['Back nine',W/2+10]].forEach(function(nn,ni){var X=nn[1],Y=280,PW=W/2-70,PH=250;
    x.save();rr(x,X,Y,PW,PH,18);x.clip();var gg=x.createLinearGradient(0,Y,0,Y+PH);gg.addColorStop(0,'#2c7a46');gg.addColorStop(1,'#23663a');x.fillStyle=gg;x.fillRect(X,Y,PW,PH);
    for(var s=-PH;s<PW;s+=52){x.fillStyle='rgba(255,255,255,.06)';x.beginPath();x.moveTo(X+s,Y+PH);x.lineTo(X+s+26,Y+PH);x.lineTo(X+s+26+PH*0.18,Y);x.lineTo(X+s+PH*0.18,Y);x.fill()}
    x.fillStyle='#e8d6a6';x.font='italic 700 24px '+SERIF;x.fillText(nn[0],X+20,Y+38);
    d.ps.filter(function(p){return p.nine===(ni?'Back':'Front')}).forEach(function(p,pi){var py=Y+62+pi*90;rr(x,X+16,py,PW-32,76,16);x.fillStyle='rgba(0,0,0,.2)';x.fill();
      x.fillStyle='#fff';x.font='700 19px '+SANS;x.fillText(fit(x,p.a.n,PW/2-70),X+32,py+32);x.textAlign='right';x.fillText(fit(x,p.b.n,PW/2-70),X+PW-32,py+32);
      x.fillStyle='#cfe6d4';x.font='600 13px '+MONO;x.fillText(String(p.b.id),X+PW-32,py+54);x.textAlign='left';x.fillText(String(p.a.id),X+32,py+54);
      x.textAlign='center';x.font='26px '+SANS;x.fillText('⛳',X+PW/2,py+46);
      var tx=p.teeA?X+32+Math.min(x.measureText('').width,0):X+PW-32,lab='TEES OFF';x.font='700 11px '+SANS;var tw=x.measureText(lab).width+14;
      var bx=p.teeA?X+32+ (function(){x.font='600 13px '+MONO;var w=x.measureText(String(p.a.id)).width;return w+10})():X+PW-32-(function(){x.font='600 13px '+MONO;return x.measureText(String(p.b.id)).width+10})()-tw;
      x.font='700 11px '+SANS;rr(x,bx,py+42,tw,17,8);x.fillStyle='#c8102e';x.fill();x.fillStyle='#fff';x.textAlign='left';x.fillText(lab,bx+7,py+54);x.textAlign='left'});
    x.restore()});
  x.strokeStyle='#e2d7ba';x.lineWidth=2;x.setLineDash([8,6]);x.beginPath();x.moveTo(60,560);x.lineTo(W-60,560);x.stroke();x.setLineDash([]);
  if(m.mp){var M=m.mp;x.textAlign='center';x.fillStyle='#0c3322';x.font='italic 700 26px '+SERIF;x.fillText((m.w===A.id?A.n:B.n)+' win '+(M.res==='AS'?'(all square, on '+(m.how==='to par'?'total score':m.how)+')':M.res),W/2,598);
    var cols=[];for(var q=0;q<18;q++){cols.push(q);if(q===8)cols.push('out')}cols.push('in','tot');
    var X0=200,CW=(W-60-X0)/cols.length,Y0=618,RH=40;
    x.fillStyle='#f3ecd7';x.fillRect(60,Y0,W-120,26);x.fillStyle='#5e6b62';x.font='700 12px '+SANS;x.textAlign='left';x.fillText('HOLE',72,Y0+18);x.textAlign='center';
    cols.forEach(function(cc,ci){x.fillText(cc==='out'?'OUT':cc==='in'?'IN':cc==='tot'?'TOT':String(cc+1),X0+CW*ci+CW/2,Y0+18)});
    [[A,M.a,M.ca],[B,M.b,M.cb]].forEach(function(T,ti){var y=Y0+26+ti*(RH+18);x.textAlign='left';x.fillStyle='#1d2a22';x.font='700 15px '+SANS;x.fillText(fit(x,T[0].n.replace(/^Team /,''),125),72,y+26);x.textAlign='center';
      cols.forEach(function(cc,ci){var cx=X0+CW*ci+CW/2,cy=y+20;
        if(typeof cc==='number'){var v=T[1][cc];if(M.clinch===cc+1){x.fillStyle='#fff3c4';x.fillRect(X0+CW*ci,y,CW,RH)}
          if(v>=1){x.strokeStyle='#c8102e';x.lineWidth=1.6;if(v>=3){x.fillStyle='#c8102e';x.beginPath();x.arc(cx,cy,13,0,7);x.fill()}else{x.beginPath();x.arc(cx,cy,13,0,7);x.stroke();if(v===2){x.beginPath();x.arc(cx,cy,17,0,7);x.stroke()}}}
          x.fillStyle=v>=3?'#fff':v===0?'#a7ae9f':'#1d2a22';x.font='700 15px '+MONO;x.fillText(v==null?'·':v===0?'–':String(v),cx,cy+5)}
        else{var c=T[2],val=cc==='out'?c.out:cc==='in'?c.inn:c.par;x.fillStyle='#f8f3e3';x.fillRect(X0+CW*ci,y,CW,RH);x.fillStyle='#0c3322';x.font='700 15px '+MONO;x.fillText(tp(val),cx,cy+5)}});
      if(!ti){var my=y+RH+12;cols.forEach(function(cc,ci){if(typeof cc!=='number')return;var dd=M.run[cc];x.fillStyle=dd>0?'#1f5a36':dd<0?'#8a5a00':'#5e6b62';x.font='700 11px '+SANS;x.fillText(dd?Math.abs(dd)+(dd>0?'▲':'▼'):'AS',X0+CW*ci+CW/2,my)})}});
    x.textAlign='left';x.fillStyle='#5e6b62';x.font='13px '+SANS;x.fillText('◯ birdie (1 run)  ◎ eagle (2)  ● albatross (3+)  – par   ▲ / ▼ who is up',72,Y0+26+2*(RH+18)+14);
  } else
  [['FRONT 9',n&&n.f],['BACK 9',n&&n.k],['OVERALL',n&&n.t],['POINTS',n&&[hf(n.p[0]),hf(n.p[1])]]].forEach(function(s,si){var cx=60+(W-120)/8*(si*2+1);x.textAlign='center';
    x.fillStyle='#5e6b62';x.font='700 14px '+SANS;x.fillText(s[0],cx,594);x.fillStyle=si===3?'#c8102e':'#1d2a22';x.font='700 34px '+MONO;x.fillText(s[1]?s[1][0]+' · '+s[1][1]:'– · –',cx,636)});
  x.textAlign='left';x.fillStyle='#f3ecd7';x.fillRect(30,H-80,W-60,50);x.fillStyle='#5e6b62';x.font='15px '+SANS;x.fillText(m.mp?'Each hole: your team’s better inning · more runs wins the hole':'Front 9 & Back 9: better of your two games · Overall: every run · 2 points wins',60,H-49);
  x.textAlign='right';x.fillText(location.host+location.pathname,W-60,H-49);x.textAlign='left';x.restore();
  var url=c.toDataURL('image/png'),a=document.createElement('a');a.href=url;a.download=(m.l||'matchup').replace(/[^A-Za-z0-9]+/g,'-')+'.png';
  try{a.click()}catch(e){}
  var box=document.getElementById('shotbox');if(box)box.innerHTML='<img id="shot" class="shot" src="'+url+'" alt="Matchup card"><div class="hint">📷 Saved. If it didn’t download, right-click the picture (or long-press on a phone) to save it, then post it in Discord.</div>'}
window.addEventListener('hashchange',function(){var h=/^#m=(.+)$/.exec(location.hash);if(h)openM(decodeURIComponent(h[1]))});

document.addEventListener('click',function(e){var el=e.target.closest?e.target.closest('.sc.tap'):null;if(el&&!e.target.closest('a'))openM(el.getAttribute('data-m'))});
function render(){
  var h='<a class="home" href="'+HOME+'" target="_top">← 🏆 All tournaments</a><header><div><div class="kick">⛳ Two Man Scramble · Match play</div><h1>'+esc(D.name||'Scramble')+'</h1><div class="sub">SmallBall · single elimination · two-club teams</div></div><div class="meta">';
  if(!D.matches)h+=(D.signupClose?'Sign-ups close <b>'+t(D.signupClose)+'</b><br>':'')+(D.start?'First tee time <b>'+t(D.start)+'</b>':'')+(D.form?'<br><a class="btn flag" href="'+esc(D.form)+'" target="_blank">📝 Sign up</a>':'');
  else h+=(D.done?'<b>Final</b>':'<b>On the course</b> · '+(D.waveMin||60)+'-minute matches')+'<br>'+(D.seeds||[]).length+' teams'+(D.prizes?'<br>🎁 '+esc(D.prizes):'');
  h+='</div></header>';
  if(D.champ)h+='<div class="champ"><span class="t">🏆</span><div>'+esc(D.champ.n)+' win the '+esc(D.name)+'!<small>'+(D.champ.clubs||[]).map(function(c){return esc(c.n)}).join(' + ')+(D.prizes?' · 🎁 '+esc(D.prizes):'')+'</small></div></div>';
  if(!D.matches){
    var E=D.entrants||[];
    h+='<h2>📋 Tee sheet <small>'+E.length+' signed up · '+Math.floor(E.length/2)+' team'+(Math.floor(E.length/2)===1?'':'s')+'</small></h2><div class="card tee">'+
      (E.length?E.map(function(e,i){return '<div class="row"><span class="n">'+(i+1)+'</span><span class="who">'+esc(e.o)+'</span><span class="club">'+esc(e.n)+'</span>'+cid(e)+(e.p?'<span class="pr">🤝 with '+esc(e.p)+'</span>':'')+'</div>'}).join(''):'<div class="row">Nobody yet. Be the first on the tee sheet!</div>')+
      '<div class="note">Teams are made when sign-ups close: partners who named each other first, everyone else drawn at random. An odd one out is the alternate.</div></div>';
    h+=rules();
  } else {
    h+='<h2>🏌️ Teams <small>'+(D.seeds||[]).length+'</small></h2><div class="card tee">'+(D.seeds||[]).map(function(x){return '<div class="row"><span class="n">'+x.s+'</span><span class="who">'+esc(x.n)+'</span>'+(x.clubs||[]).map(function(c){return '<span class="club">'+esc(c.n)+'</span>'+cid(c)}).join('')+(x.how==='picked'?'<span class="pr">🤝 picked</span>':'<span class="pr" style="background:#f3ecd7;color:#6b5a1a">🎲 drawn</span>')+'</div>'}).join('')+(D.alt?'<div class="note">🪑 Alternate this week: '+esc(D.alt.o)+' ('+esc(D.alt.n)+'), first in line if anyone drops.</div>':'')+'</div>';
    var R={},order=[];(D.matches||[]).forEach(function(m){if(m.v)return;if(!R[m.r]){R[m.r]=[];order.push(m.r)}R[m.r].push(m)});
    h+='<h2>⛳ The draw</h2><div class="rounds">'+order.map(function(r){var L=R[r].filter(function(m){return !m.bye});if(!L.length)return'';
      var nm=L[0].l.split(' · ')[0];return '<div class="col"><h3>'+esc(nm)+'</h3><div class="list">'+L.map(card).join('')+'</div></div>'}).join('')+'</div>';
    h+=rules();
  }
  if(D.updated)h+='<div class="upd">Updated '+t(D.updated)+' · refreshes by itself</div>';
  document.getElementById('app').innerHTML=h;
  var hm=/^#m=(.+)$/.exec(location.hash);if(hm&&!document.getElementById('shot'))openM(decodeURIComponent(hm[1]))}
render();
if(!/demo=1/.test(location.search))setTimeout(function(){location.reload()},60000);
</script></body></html>
`;

// ===================== Demo data for ?demo=1 =====================
function demoSnap_() {
  const names = [['Leming Satellites', 'philipgonzales3', 9], ['The Usual Suspects', 'rgbartley', 9], ['Terrapin Station', 'slipnsliders', 9], ['Flying Lavender Zebras', 'ArchHen', 9], ['Tide Pride', 'evil slip', 8], ['Teton Sliders', 'Slip', 3]];
  const ents = names.map((x, i) => ({ Club: x[0], Discord: x[1], ClubID: 1000 + i, Stars: x[2], Joined: new Date(2026, 10, 25, 8, i), Status: 'In' }));
  const C = { SEEDING: 'signup', FORMAT: 'double', GRAND_FINAL_RESET: 'yes' };
  const T = createTournament_(ents, C), byId = {}; ents.forEach((e) => { byId[e.ClubID] = e; });
  // Play the first few real matches: the higher seed wins, with one upset.
  let gid = 6990;
  for (let k = 0; k < 6; k++) {
    const m = T.matches.find((x) => !x.winner && !x.void && sideClub_(T, x.a) > 0 && sideClub_(T, x.b) > 0); if (!m) break;
    const a = sideClub_(T, m.a), b = sideClub_(T, m.b), hi = seedOf_(T, a) < seedOf_(T, b) ? a : b, w = k === 2 ? (hi === a ? b : a) : hi;
    m.winner = w; m.loser = w === a ? b : a; m.score = [4 + (k % 3), k % 3]; m.gid = String(++gid); settle_(T);
  }
  const live = T.matches.find((x) => !x.winner && !x.void && sideClub_(T, x.a) > 0 && sideClub_(T, x.b) > 0);
  const now = Date.now();
  const club = (id) => (id > 0 ? { id, n: byId[id].Club, o: byId[id].Discord, s: seedOf_(T, id), st: String(byId[id].Stars) } : null);
  return { name: 'Black Friday Brawl (demo)', updated: now, prizes: 'SmallBall Tickets and pictures of dogs', signupClose: now - 864e5, start: now - 3 * 36e5, waveMin: 60, fmt: T.fmt, wave: 4, done: false,
    entrants: ents.map((e) => ({ n: e.Club, o: e.Discord, id: e.ClubID, st: String(e.Stars) })), seeds: T.seeds.map((s) => club(s.club)),
    matches: T.matches.map((m) => ({ id: m.id, b: m.bracket, r: m.round, l: m.label, a: club(sideClub_(T, m.a)), z: club(sideClub_(T, m.b)), byeA: sideClub_(T, m.a) === BYE, byeZ: sideClub_(T, m.b) === BYE,
      w: m.winner > 0 ? m.winner : null, sc: m.score || null, how: '', bye: !!m.bye, v: !!m.void, open: !m.winner && !m.void && sideClub_(T, m.a) > 0 && sideClub_(T, m.b) > 0, dl: now + 25 * 60000, g: live && m.id === live.id ? '7012' : '', live: !!live && m.id === live.id, flag: false })) };
}

// ===================== The bracket page =====================
const BRACKET_HTML_ = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Oswald:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#0E1B33;--panel:#15274a;--edge:#2b4170;--ink:#F4EBD9;--muted:#9fb0cf;--red:#C8102E;--gold:#ffd166;--green:#34d399}
*{box-sizing:border-box}body{margin:0;background:var(--bg) repeating-linear-gradient(135deg,rgba(255,255,255,.02) 0 1px,transparent 1px 14px);color:var(--ink);font:15px/1.4 Oswald,system-ui,sans-serif}
.bb{font-family:"Bebas Neue",Oswald,sans-serif;letter-spacing:.04em}
header{padding:18px 22px 8px;display:flex;flex-wrap:wrap;gap:12px 24px;align-items:end;justify-content:space-between}
h1{margin:0;font-size:46px;line-height:.95}h1 small{display:block;font-size:17px;color:var(--gold);letter-spacing:.12em}
.meta{color:var(--muted);font-size:14px;text-align:right}.meta b{color:var(--ink)}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;justify-content:flex-end}
.btn{background:var(--panel);border:1px solid var(--edge);color:var(--ink);border-radius:999px;padding:7px 14px;font:600 13px Oswald,sans-serif;cursor:pointer;text-decoration:none}
.btn.go{background:var(--red);border-color:var(--red)}
.champ{margin:8px 22px;padding:14px 18px;border-radius:12px;background:linear-gradient(90deg,rgba(200,16,46,.5),rgba(255,209,102,.2));box-shadow:0 0 0 2px var(--gold) inset;font-size:22px}
.sec{padding:6px 22px 18px}.sec h2{margin:10px 0 8px;font-size:28px;color:var(--gold)}
.cols{display:flex;gap:14px;overflow-x:auto;padding-bottom:8px}
.col{display:flex;flex-direction:column;justify-content:space-around;gap:10px;min-width:210px}
.col h3{margin:0 0 2px;font:600 12px Oswald,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.m{background:var(--panel);border:1px solid var(--edge);border-radius:10px;overflow:hidden}
.m.bye{opacity:.5}.m.open{border-color:var(--red);box-shadow:0 0 0 1px var(--red)}.m.live{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold)}
.m .lab{font-size:11px;color:var(--muted);padding:4px 9px 2px;display:flex;justify-content:space-between;gap:8px}
.m .s{display:grid;grid-template-columns:24px 1fr auto;gap:6px;align-items:center;padding:5px 9px;border-top:1px solid rgba(255,255,255,.05)}
.cid{color:var(--gold);font-weight:700;text-decoration:none;border-bottom:1px dotted var(--gold)}.cid:hover{color:#fff}
.ids{display:flex;flex-wrap:wrap;gap:8px}.ids a{display:inline-flex;align-items:baseline;gap:8px;background:var(--panel);border:1px solid var(--edge);border-radius:10px;padding:7px 12px;color:var(--ink);text-decoration:none}.ids a:hover{border-color:var(--gold)}.ids b{font:600 18px Oswald,sans-serif;color:var(--gold);letter-spacing:.03em}.ids i{font-style:normal;color:var(--muted);font-size:12px}.ids em{font-style:normal;color:var(--muted);font-size:12px;min-width:18px}
.m .s .sd{font-size:12px;color:var(--muted);text-align:right}.m .s .n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.m .s .n small{color:var(--muted);margin-left:5px}
.m .s.w{background:rgba(52,211,153,.12)}.m .s.w .n{font-weight:600}.m .s.l .n{opacity:.5;text-decoration:line-through}
.m .s .sc{font-weight:600;min-width:16px;text-align:right}.m .tbd{color:var(--muted);font-style:italic}
.m .ft{font-size:11px;padding:3px 9px 5px;color:var(--gold)}.m .ft a{color:var(--gold)}
.pv{background:var(--panel);border:1px dashed var(--gold);border-radius:12px;padding:12px 16px;font-size:16px}.pv span{color:var(--muted);font-size:14px}.pv .btn{margin-left:8px}
.m .s.openspot .n{color:#6f84ab}
.ents{display:flex;flex-wrap:wrap;gap:8px}.ents span{background:var(--panel);border:1px solid var(--edge);border-radius:999px;padding:5px 12px}
.empty{color:var(--muted);padding:20px 22px}
.rules{background:var(--panel);border:1px solid var(--edge);border-radius:12px;padding:4px 18px 14px}
.rules summary{cursor:pointer;list-style:none;padding:12px 0 6px}.rules summary::-webkit-details-marker{display:none}
.rules summary h2{display:inline;margin:0}.rules summary span{color:var(--muted);font-size:13px;margin-left:8px}
.rgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-top:6px}
.rcard{background:rgba(255,255,255,.03);border:1px solid var(--edge);border-radius:10px;padding:10px 14px}
.rcard h3{margin:0 0 6px;font:600 15px Oswald,sans-serif;color:var(--gold);letter-spacing:.04em}
.rcard ul{margin:0;padding-left:18px}.rcard li{margin:3px 0;font-size:14px}.rcard b{color:var(--ink)}
.when{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 2px}.when span{background:rgba(255,209,102,.12);border:1px solid rgba(255,209,102,.4);border-radius:999px;padding:4px 12px;font-size:13px}
footer{color:var(--muted);font-size:12px;padding:14px 22px 26px}
/* ── Ballpark look: textures, scoreboard scores, colour-coded brackets ── */
body{background-color:#0b1730;background-image:
  radial-gradient(1200px 600px at 50% -10%,rgba(255,209,102,.10),transparent 60%),
  radial-gradient(900px 500px at 110% 110%,rgba(200,16,46,.14),transparent 60%),
  repeating-linear-gradient(90deg,rgba(255,255,255,.018) 0 2px,transparent 2px 44px),
  repeating-linear-gradient(135deg,rgba(255,255,255,.022) 0 1px,transparent 1px 12px);background-attachment:fixed}
.home{display:inline-block;color:var(--gold);font:600 13px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-decoration:none;margin:0 0 8px;opacity:.9}.home:hover{opacity:1;text-decoration:underline}
header{margin:14px 16px 6px;padding:16px 20px;border-radius:16px;background:linear-gradient(180deg,#13254a,#0d1b38);border:1px solid #2b4170;box-shadow:0 10px 30px rgba(0,0,0,.35),inset 0 1px 0 rgba(255,255,255,.06);position:relative;overflow:hidden}
header::before{content:"";position:absolute;inset:6px;border-radius:12px;pointer-events:none;border:2px dashed rgba(200,16,46,.55)}
header::after{content:"⚾";position:absolute;right:-18px;bottom:-34px;font-size:120px;opacity:.06;transform:rotate(-18deg)}
h1{font-size:52px;text-shadow:0 2px 0 rgba(0,0,0,.4)}
.sec h2{display:inline-block;font-size:30px;padding-bottom:2px;border-bottom:3px solid var(--red)}
.sec.wb,.sec.lb,.sec.gf{margin:10px 16px;padding:12px 16px 16px;border-radius:16px;border:1px solid #2b4170;background:linear-gradient(180deg,rgba(21,39,74,.85),rgba(11,23,48,.85))}
.sec.wb{box-shadow:inset 4px 0 0 var(--gold)}.sec.lb{box-shadow:inset 4px 0 0 var(--red)}
.sec.gf{box-shadow:inset 4px 0 0 var(--gold),0 0 40px rgba(255,209,102,.12);background:linear-gradient(180deg,rgba(60,44,10,.55),rgba(11,23,48,.9))}
.sec.lb h2{border-bottom-color:var(--gold)}
.cols{gap:28px;padding:4px 2px 10px}
.col{min-width:238px;gap:10px;justify-content:flex-start}.ms{flex:1;display:flex;flex-direction:column;justify-content:space-around;gap:14px}
.col h3{align-self:flex-start;background:rgba(255,209,102,.12);border:1px solid rgba(255,209,102,.35);color:var(--gold);border-radius:999px;padding:3px 10px;font-size:11px}
.m{position:relative;overflow:visible;border-radius:12px;border:1px solid #31497a;background:
  linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,0) 40%),
  repeating-linear-gradient(0deg,rgba(255,255,255,.015) 0 1px,transparent 1px 3px),#142649;box-shadow:0 6px 16px rgba(0,0,0,.35)}
.col:not(:last-child) .m::after{content:"";position:absolute;right:-29px;top:50%;width:28px;border-top:2px solid rgba(159,176,207,.35)}
.col:not(:first-child) .m::before{content:"";position:absolute;left:-29px;top:50%;width:14px;border-top:2px solid rgba(159,176,207,.35)}
.m .lab{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;padding:6px 10px 4px;border-bottom:1px solid rgba(255,255,255,.06);border-radius:12px 12px 0 0;background:rgba(0,0,0,.18)}
.m .s{grid-template-columns:26px 1fr 34px;padding:7px 10px;border-top:1px solid rgba(255,255,255,.06)}
.m .s:nth-child(odd){background:rgba(255,255,255,.02)}
.m .s .sd{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#0b1730;border:1px solid #3a5488;color:var(--muted);font-size:11px;text-align:center}
.m .s .n{white-space:normal;overflow:visible;font-size:15px;line-height:1.15}
.m .s .n small{display:block;margin:2px 0 0;font-size:11.5px}
.m .s .sc{display:inline-grid;place-items:center;min-width:30px;height:26px;border-radius:6px;background:#06101f;border:1px solid #233a66;color:#ffe9a8;font:600 17px "Bebas Neue",Oswald,sans-serif;letter-spacing:.04em;box-shadow:inset 0 1px 6px rgba(0,0,0,.6)}
.m .s .sc:empty{background:transparent;border-color:transparent;box-shadow:none}
.m .s.w{background:linear-gradient(90deg,rgba(52,211,153,.22),rgba(52,211,153,.04));box-shadow:inset 3px 0 0 var(--green)}
.m .s.w .sd{border-color:var(--green);color:var(--green)}.m .s.w .sc{color:#b9ffe0;border-color:#1e6b52}
.m .s.l .n{opacity:.45;text-decoration:none}.m .s.l .sc{opacity:.6}
.m.open{border-color:var(--red);box-shadow:0 0 0 1px var(--red),0 0 18px rgba(200,16,46,.35)}
.m.open .lab{background:linear-gradient(90deg,rgba(200,16,46,.55),rgba(200,16,46,.15));color:#fff}
.m.live{border-color:var(--gold);animation:live 2s ease-in-out infinite}
.m.live .lab{background:linear-gradient(90deg,rgba(255,209,102,.45),rgba(255,209,102,.1));color:#fff}
@keyframes live{0%,100%{box-shadow:0 0 0 1px var(--gold),0 0 8px rgba(255,209,102,.25)}50%{box-shadow:0 0 0 1px var(--gold),0 0 22px rgba(255,209,102,.55)}}
.m.bye{opacity:.35;filter:saturate(.4)}
.m .ft{font-size:11.5px;padding:6px 10px 8px;border-top:1px dashed rgba(255,209,102,.25)}
.ids a{border-radius:12px;background:linear-gradient(180deg,#183058,#122444);box-shadow:0 4px 10px rgba(0,0,0,.25)}
.ids b{font:600 20px "Bebas Neue",Oswald,sans-serif;background:#06101f;border:1px solid #233a66;border-radius:6px;padding:0 7px;color:#ffe9a8}
.pv{background:linear-gradient(90deg,rgba(255,209,102,.10),rgba(21,39,74,.6));border-radius:14px}
.rules{background:linear-gradient(180deg,rgba(21,39,74,.9),rgba(11,23,48,.9));border-radius:16px}
.rcard{background:rgba(6,16,31,.45);border-radius:12px}

/* ── Readability pass: clear sans for small text, bigger sizes, brighter secondary text, plain card faces ── */
:root{--muted:#c3cfe6}
body{font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.m{background:#15294f}
.m .s:nth-child(odd){background:transparent}
.m .lab{font:700 11.5px system-ui,sans-serif;letter-spacing:.05em;color:#dbe4f5}
.m .s{padding:8px 10px}
.m .s .n{font:600 15.5px/1.2 system-ui,sans-serif;color:#fff}
.m .s .n small{font:500 12.5px system-ui,sans-serif;color:var(--muted)}
.m .s .n small .cid{font-weight:700}
.m .s .sd{font:700 11.5px system-ui,sans-serif;color:#dbe4f5;width:24px;height:24px}
.m .s.l .n{opacity:.62}.m .s.l .n small{opacity:.9}
.m .tbd{color:#9fb0cf;font-weight:500}
.m .ft{font:600 12.5px system-ui,sans-serif}
.col h3{font:800 11.5px system-ui,sans-serif;letter-spacing:.07em}
.ids a span{font:600 15px system-ui,sans-serif}.ids i{font-size:12.5px}.ids em{font:700 12.5px system-ui,sans-serif}
.meta{font-size:14.5px}
.pv{font-size:16px}.pv span{font-size:14.5px}
.rcard li{font-size:15px;line-height:1.45}.rcard h3{font:700 16px system-ui,sans-serif}
.when span{font-size:14px}
.btn{font:700 13.5px system-ui,sans-serif}
@media(max-width:640px){h1{font-size:40px}.col{min-width:216px}.sec.wb,.sec.lb,.sec.gf{margin:8px 8px;padding:10px}}
</style></head><body><div id="app"></div>
<script>
var D=__DATA__;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function t(ms){return new Date(ms).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit',timeZoneName:'short'})}
function side(c,bye,m,isA){
  if(bye)return '<div class="s"><span class="sd"></span><span class="n tbd">bye</span><span></span></div>';
  if(!c)return '<div class="s"><span class="sd"></span><span class="n tbd">TBD</span><span></span></div>';
  if(c.open)return '<div class="s openspot"><span class="sd">'+c.s+'</span><span class="n tbd">Open spot</span><span></span></div>';
  var cls=m.w?(m.w===c.id?' w':' l'):'',sc=m.sc&&m.w?(m.w===c.id?m.sc[0]:m.sc[1]):'';
  return '<div class="s'+cls+'"><span class="sd">'+(c.s||'')+'</span><span class="n">'+esc(c.n)+'<small>'+(c.id>0?'<a class="cid" href="https://play.smallball.com/#/team/'+esc(c.id)+'" target="_blank" title="Open on SmallBall">ID '+esc(c.id)+'</a> · ':'')+esc(c.o||'')+(c.st!==''&&c.st!=null?' · '+esc(c.st)+'★':'')+'</small></span><span class="sc">'+sc+'</span></div>';
}
function box(m){
  var st=m.v?'':m.bye?'':m.w?(m.how==='no-show'?'No-show: higher seed on':m.how==='organizer'?'Settled by the organizer':m.how==='tie'?'Tie: higher seed on':''):m.live?'📡 Game found · result once it airs':m.flag?'Waiting on the organizer':m.open?'🔴 Open · play by '+t(m.dl):'';
  if(m.open&&!m.live&&!m.w&&m.a&&m.z&&m.a.s&&m.z.s){var cc=m.a.s>m.z.s?m.a:m.z,dd=cc===m.a?m.z:m.a;st+='<br>🥊 '+esc(cc.n)+' starts it: <a class="cid" href="https://play.smallball.com/?sbx_as='+esc(cc.id)+'#/team/'+esc(dd.id)+'" target="_blank">▶ Play vs ID '+esc(dd.id)+'</a>';}
  var ft=m.g?(st?st+' · ':'')+'<a href="https://play.smallball.com/training?watch='+esc(m.g)+'" target="_blank">📺 game '+esc(m.g)+'</a>':st;
  return '<div class="m'+(m.live?' live':m.open?' open':'')+(m.byeA||m.byeZ?' bye':'')+'"><div class="lab"><span>'+esc(((m.l||m.id).split(' · ')[1])||m.l||m.id)+'</span></div>'+side(m.a,m.byeA,m,true)+side(m.z,m.byeZ,m,false)+(ft?'<div class="ft">'+ft+'</div>':'')+'</div>';
}
function cols(list,name){
  var rs={};list.forEach(function(m){(rs[m.r]=rs[m.r]||[]).push(m)});
  return '<div class="cols">'+Object.keys(rs).sort(function(a,b){return a-b}).map(function(r){var ms=rs[r].filter(function(m){return !m.v&&!(m.bye&&m.byeA&&m.byeZ)&&!(m.b==='L'&&(m.byeA||m.byeZ))});if(!ms.length)return'';return '<div class="col"><h3>'+esc(name(r,ms))+'</h3><div class="ms">'+ms.map(box).join('')+'</div></div>'}).join('')+'</div>';
}
function rules(){
  var w=D.waveMin||60,open=!D.matches;
  function li(a){return '<ul>'+a.map(function(x){return '<li>'+x+'</li>'}).join('')+'</ul>'}
  function card(t,a){return '<div class="rcard"><h3>'+t+'</h3>'+li(a)+'</div>'}
  var h='<div class="sec"><details class="rules"'+(open?' open':'')+'><summary><h2 class="bb">📜 Rules &amp; how it works</h2><span>tap to show or hide</span></summary>';
  h+='<div class="when">'+(D.signupClose?'<span>📝 Sign-ups close <b>'+t(D.signupClose)+'</b></span>':'')+(D.start?'<span>⚾ Wave 1 opens <b>'+t(D.start)+'</b></span>':'')+'<span>⏱ Each match: <b>'+w+' minutes to play</b></span><span>📺 Results: <b>~25 min after the game</b></span></div>';
  h+='<div class="rgrid">';
  h+=card('✍️ Signing up',[(Number(D.perOwner) > 1 ? 'Up to ' + D.perOwner + ' clubs per owner (one form each).' : 'One club per owner.') + ' <b>BigLeague</b> clubs, any star level.','Seeded by <b>sign-up order</b>: first in is the #1 seed.','Changing clubs? Send the form again with the same email before sign-ups close. After the draw, your club is locked in.','Already on Hold the Hill? Enter your email and submit; the rest fills in.']);
  h+=card('⏱ Your match window',['<b>Wave 1</b> opens every first-round match at once'+(D.start?' ('+t(D.start)+')':'')+'.','After that, <b>your next match opens the moment both clubs are known</b> (once the earlier results have aired). You get tagged in the Brawl channel.','You have <b>'+w+' minutes</b> from the ping to play.','<b>Play early in your window:</b> the sooner your result airs, the sooner your next match opens. Stick around while you’re still alive.']);
  h+=card('🥊 Playing your game',['<b>The lower seed starts the game</b>: tap the Start-the-game link in the ping, check YOUR CLUB at the top of SmallBall, then hit Play (not Exhibition). Nothing for the higher seed to accept.','Play <b>one BigLeague game</b> against your opponent. Exhibitions and pro games don’t count.','<b>The first game you two finish inside the window is the one that counts.</b> No warm-up games against your opponent.','No reporting: the bracket finds the game on SmallBall by itself.']);
  h+=card('⚖️ When things go sideways',['<b>No game in time:</b> the higher seed moves on. Lower seeds, it’s on you to make it happen.','<b>A tie:</b> play it again. The match gets 30 more minutes.','<b>Double elimination:</b> one loss drops you to the losers bracket; two and you’re out.','<b>Grand final:</b> if the losers-bracket champ wins, one more game decides it.']);
  h+=card('🤝 Expectations',['Be around Friday from Wave 1 until you’re out. Your next match can open any time, not just on the hour.','Higher seeds: keep your lineup ready; the game can start any time in your window. Lower seeds: don’t wait for the clock to run out.','Results post once each game has aired, so watch live without spoilers, and don’t post scores early.','Problem with a result? Ping the organizer in the Brawl channel; results can be fixed by hand.']);
  h+='</div>'+(D.prizes?'<p style="margin:12px 2px 0">🎁 <b>Prizes:</b> '+esc(D.prizes)+'</p>':'')+'</details></div>';
  return h;
}
function render(){
  var HOME=/github\.io$/.test(location.host)?location.pathname.split('/').slice(0,2).join('/')+'/tournaments/':'https://slipnsliders.github.io/smallball-tools/tournaments/';
  var h='<header><div><a class="home" href="'+HOME+'" target="_top">← 🏆 All tournaments</a><h1 class="bb"><small>SMALLBALL TOURNAMENT</small>'+esc(D.name||'Tournament')+'</h1></div><div class="meta">';
  if(!D.matches){h+=(D.signupClose?'Sign-ups close <b>'+t(D.signupClose)+'</b><br>':'')+(D.start?'Wave 1 <b>'+t(D.start)+'</b>':'');}
  else h+=(D.done?'<b>Finished</b>':'<b>Live</b> · '+(D.waveMin||60)+'-minute match windows')+'<br>'+(D.fmt==='double'?'Double elimination':'Single elimination')+' · '+(D.seeds||[]).length+' clubs';
  h+='<div class="btns">'+(D.form&&!D.matches?'<a class="btn go" href="'+esc(D.form)+'" target="_blank">📝 Sign up</a>':'')+(D.matches?'<button class="btn" onclick="png()">📷 Save as image</button>':'')+'</div></div></header>';
  if(D.champ)h+='<div class="champ bb">👑 '+esc(D.champ.n)+' wins the '+esc(D.name)+'!'+(D.prizes?' <span style="font-size:15px;font-family:Oswald">🎁 '+esc(D.prizes)+'</span>':'')+'</div>';
  var IDL=D.matches?(D.seeds||[]):(D.entrants||[]);
  h+='<div class="sec"><h2 class="bb">'+(D.matches?'🆔 Club IDs':'Signed up · '+IDL.length)+'</h2><div style="color:var(--muted);font-size:13px;margin:-4px 0 8px">The club ID is what you play in SmallBall. Tap one to open that club, with the Play button.</div>'+(IDL.length?'<div class="ids">'+IDL.map(function(e){return '<a href="https://play.smallball.com/#/team/'+esc(e.id)+'" target="_blank">'+(e.s?'<em>#'+esc(e.s)+'</em>':'')+'<span>'+esc(e.n)+' <i>'+esc(e.o||'')+(e.st!==''&&e.st!=null?' · '+esc(e.st)+'★':'')+'</i></span><b>'+esc(e.id)+'</b></a>'}).join('')+'</div>':'<div class="empty">Nobody yet. Be the first!</div>')+'</div>';
  if(!D.matches&&D.preview){
    var P=D.preview,sd={signup:'sign-up order (the sooner you sign up, the higher your seed)',stars:'stars, most first',random:'a random draw when sign-ups close'}[P.seeding]||'sign-up order';
    h+='<div class="sec"><div class="pv"><b>Bracket preview</b> · '+P.filled+' of '+P.size+' spots filled · seeded by '+esc(sd)+'.<br><span>This is the bracket we\u2019re building toward. The real one is drawn when sign-ups close'+(D.signupClose?' ('+t(D.signupClose)+')':'')+', sized to who\u2019s in.</span>'+(D.form?' <a class="btn go" href="'+esc(D.form)+'" target="_blank">📝 Grab a spot</a>':'')+'</div></div>';
    h+=rules();
    var PW=P.matches.filter(function(m){return m.b==='W'}),PL=P.matches.filter(function(m){return m.b==='L'}),PF=P.matches.filter(function(m){return m.b==='F'});
    h+='<div class="sec wb"><h2 class="bb">'+(P.fmt==='double'?'🏆 Winners bracket':'🏆 Bracket')+'</h2>'+cols(PW,function(r,ms){return ms[0].l.split(' · ')[0]})+'</div>';
    if(PL.length)h+='<div class="sec lb"><h2 class="bb">🥊 Losers bracket</h2>'+cols(PL,function(r,ms){return ms[0].l.split(' · ')[0]})+'</div>';
    if(PF.length)h+='<div class="sec gf"><h2 class="bb">👑 Grand final</h2><div class="cols">'+PF.map(function(m){return '<div class="col">'+box(m)+'</div>'}).join('')+'</div></div>';
  }
  if(!D.matches){
    // (the sign-up list now sits at the top, with club IDs)
  } else {
    var W=D.matches.filter(function(m){return m.b==='W'}),L=D.matches.filter(function(m){return m.b==='L'}),F=D.matches.filter(function(m){return m.b==='F'&&!m.v});
    var wr=Math.max.apply(null,W.map(function(m){return m.r})),lr=Math.max.apply(null,L.map(function(m){return m.r}).concat([0]));
    h+='<div class="sec wb"><h2 class="bb">'+(D.fmt==='double'?'🏆 Winners bracket':'🏆 Bracket')+'</h2>'+cols(W,function(r,ms){return ms[0].l.split(' · ')[0]})+'</div>';
    if(L.length)h+='<div class="sec lb"><h2 class="bb">🥊 Losers bracket</h2>'+cols(L,function(r,ms){return ms[0].l.split(' · ')[0]})+'</div>';
    if(F.length)h+='<div class="sec gf"><h2 class="bb">👑 Grand final</h2><div class="cols">'+F.map(function(m){return '<div class="col">'+box(m)+'</div>'}).join('')+'</div></div>';
  }
  if(D.matches)h+=rules();
  h+='<footer>Updated '+t(D.updated||Date.now())+' · refreshes on its own · results show once each game has aired (no spoilers) · read-only on SmallBall</footer>';
  document.getElementById('app').innerHTML=h;
}
// A picture of the whole bracket, drawn on a canvas (no outside services).
function png(){
  var secs=[],W=D.matches.filter(function(m){return m.b==='W'}),L=D.matches.filter(function(m){return m.b==='L'}),F=D.matches.filter(function(m){return m.b==='F'&&!m.v});
  function group(list){var rs={};list.filter(function(m){return !m.v&&!(m.bye&&m.byeA&&m.byeZ)&&!(m.b==='L'&&(m.byeA||m.byeZ))}).forEach(function(m){(rs[m.r]=rs[m.r]||[]).push(m)});return Object.keys(rs).sort(function(a,b){return a-b}).map(function(r){return rs[r]})}
  secs.push([D.fmt==='double'?'WINNERS BRACKET':'BRACKET',group(W)]);if(L.length)secs.push(['LOSERS BRACKET',group(L)]);if(F.length)secs.push(['GRAND FINAL',[F]]);
  var BW=230,BH=64,GX=24,GY=12,PAD=28,y=110,maxCols=0,heights=[];
  secs.forEach(function(s){maxCols=Math.max(maxCols,s[1].length);var most=Math.max.apply(null,s[1].map(function(c){return c.length}));heights.push(40+most*(BH+GY))});
  var cw=PAD*2+maxCols*(BW+GX),ch=y+heights.reduce(function(a,b){return a+b},0)+(D.champ?60:0)+30;
  var c=document.createElement('canvas'),k=2;c.width=cw*k;c.height=ch*k;var x=c.getContext('2d');x.scale(k,k);
  x.fillStyle='#0E1B33';x.fillRect(0,0,cw,ch);
  x.fillStyle='#ffd166';x.font='600 14px Oswald, sans-serif';x.fillText('SMALLBALL TOURNAMENT',PAD,40);
  x.fillStyle='#F4EBD9';x.font='40px "Bebas Neue", Oswald, sans-serif';x.fillText(D.name||'Tournament',PAD,80);
  x.fillStyle='#9fb0cf';x.font='13px Oswald, sans-serif';x.fillText((D.done?'Final':'Live')+' · '+new Date().toLocaleString([],{timeZoneName:'short'}),cw-PAD-260,80);
  if(D.champ){x.fillStyle='#C8102E';x.fillRect(PAD,y-6,cw-PAD*2,44);x.fillStyle='#ffd166';x.font='28px "Bebas Neue", Oswald, sans-serif';x.fillText('👑 '+D.champ.n+' wins!',PAD+14,y+26);y+=60}
  secs.forEach(function(s,si){
    x.fillStyle='#ffd166';x.font='24px "Bebas Neue", Oswald, sans-serif';x.fillText(s[0],PAD,y+22);
    var top=y+36,colsH=heights[si]-40;
    s[1].forEach(function(col,ci){
      var cx=PAD+ci*(BW+GX),step=colsH/col.length;
      col.forEach(function(m,mi){
        var by=top+mi*step+(step-BH)/2;
        x.fillStyle='#15274a';x.strokeStyle=m.open?'#C8102E':m.live?'#ffd166':'#2b4170';x.lineWidth=1.5;
        x.beginPath();x.rect(cx,by,BW,BH);x.fill();x.stroke();
        x.fillStyle='#9fb0cf';x.font='10px Oswald, sans-serif';x.fillText((m.l||m.id).slice(0,40),cx+8,by+12);
        [[m.a,m.byeA,0],[m.z,m.byeZ,1]].forEach(function(p){
          var cc=p[0],ry=by+18+p[2]*22,won=m.w&&cc&&m.w===cc.id;
          if(won){x.fillStyle='rgba(52,211,153,.18)';x.fillRect(cx+1,ry,BW-2,22)}
          x.fillStyle=cc?(m.w&&!won?'#7b8aa8':'#F4EBD9'):'#7b8aa8';x.font=(won?'600 ':'')+'13px Oswald, sans-serif';
          x.fillText(p[1]?'bye':cc?((cc.s?cc.s+'  ':'')+cc.n).slice(0,28):'TBD',cx+8,ry+16);
          if(m.sc&&m.w&&cc){x.textAlign='right';x.fillText(String(m.w===cc.id?m.sc[0]:m.sc[1]),cx+BW-8,ry+16);x.textAlign='left'}
        });
      });
    });
    y+=heights[si];
  });
  x.fillStyle='#9fb0cf';x.font='11px Oswald, sans-serif';x.fillText('Results show once each game has aired · read-only on SmallBall',PAD,ch-12);
  var url=c.toDataURL('image/png');
  try{var a=document.createElement('a');a.download=(D.name||'bracket').replace(/[^a-z0-9]+/gi,'-')+'.png';a.href=url;document.body.appendChild(a);a.click();a.remove();}catch(e){}
  var o=document.getElementById('shot')||document.createElement('div');o.id='shot';
  o.style.cssText='position:fixed;inset:0;background:rgba(5,10,20,.92);z-index:9;overflow:auto;padding:18px;text-align:center';
  o.innerHTML='<p style="margin:0 0 10px">📷 Here\\u2019s the bracket. If it didn\\u2019t download, right-click it (or long-press on a phone) and save it, then post it in Discord. <button class="btn" onclick="this.closest(\\'#shot\\').remove()">Close</button></p><img style="max-width:100%;border-radius:8px" src="'+url+'">';
  document.body.appendChild(o);
}
render();
if(!/demo=1/.test(location.search))setTimeout(function(){location.reload()},60000);
</script></body></html>`;
