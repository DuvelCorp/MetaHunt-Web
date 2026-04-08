// MetaHunt-Web — Unified beast browser + zone map viewer
// Merges: MetaHunt-web (map viewer) + Session_Package/docs (beast browser)

// ══════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

const MAP_W = 1002;
const MAP_H = 668;

const FAMILY_COLORS = {
  'Bears':          '#c0703a',
  'Boars':          '#a06030',
  'Bats':           '#7060b0',
  'Birds of Prey':  '#50a0d0',
  'Carrion Birds':  '#8080a0',
  'Cats':           '#d0a030',
  'Crabs':          '#d06060',
  'Crocolisks':     '#508050',
  'Dragonhawks':    '#c040c0',
  'Gorillas':       '#808040',
  'Hyenas':         '#c0b040',
  'Owls':           '#6090c0',
  'Raptors':        '#70c060',
  'Ravagers':       '#c05080',
  'Scorpids':       '#d08000',
  'Serpents':       '#20b060',
  'Spiders':        '#b060d0',
  'Tallstriders':   '#40b0b0',
  'Turtles':        '#30a040',
  'Wind Serpents':  '#40d0d0',
  'Wolves':         '#e03030',
  'Worms':          '#a07060',
  'Unknown':        '#808080',
};

// WMA IDs hidden from zone sidebar (instances, BGs, etc.)
const HIDDEN_WMAS = new Set([
  654,655,522,461,14,663,623,519,635,523,670,514,659,689,678,704,665,500,
  613,518,672,341,13,517,680,241,667,668,627,603,639,625,502,643,645,646,
  520,648,652,637,611,702,696,701,700,521,682,683,516,443,698,705,694,
]);

// ══════════════════════════════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════════════════════════════

const state = {
  zones: {},            // { wmaId: zoneName }
  beasts: [],           // full beast array from JSON
  beastsById: {},       // { npcId: beast }
  families: {},         // { familyName: { icon, abilities, food, stats } }
  spells: {},           // { abilityName: [{ rank, icon, description, ... }] }
  filtered: [],         // current filtered view for beast table
  selectedNpcId: null,  // beast browser selection
  currentWma: null,     // map viewer current zone
};

// ══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════════════════

function familyColor(family) {
  return FAMILY_COLORS[family] || '#aaaaaa';
}

function asText(v) {
  return v === undefined || v === null || v === '' ? '—' : String(v);
}

function esc(v) {
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDuration(sec) {
  if (sec == null || sec === '') return '—';
  const s = Number(sec);
  if (isNaN(s) || s <= 0) return asText(sec);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d} day${d > 1 ? 's' : ''}`);
  if (h) parts.push(`${h} hour${h > 1 ? 's' : ''}`);
  if (m) parts.push(`${m} min`);
  if (!parts.length) parts.push(`${s} sec`);
  return parts.join(' ');
}

function fmtRespawn(minSec, maxSec) {
  const a = fmtDuration(minSec);
  const b = fmtDuration(maxSec);
  if (a === '—' && b === '—') return '—';
  return a === b ? a : `${a} – ${b}`;
}

function fmtDmg(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return asText(v);
  return n >= 100 ? Math.round(n).toString() : n.toFixed(1);
}

function fmtDate(iso) {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function familyIcon(family) {
  const fam = state.families[family];
  return fam?.icon ? `<img class="icon" src="icons/${fam.icon}.png" alt="${esc(family)}">` : '';
}

function abilityIcon(abilityName) {
  // abilityName could be "Bite 7" — extract base name + rank
  const m = abilityName.match(/^(.+?)\s+(\d+)$/);
  const base = m ? m[1] : abilityName;
  const rankNum = m ? parseInt(m[2]) : null;
  const ranks = state.spells[base];
  if (!ranks?.length) return '';
  const entry = (rankNum != null && ranks.find(r => r.rank === rankNum)) || ranks[ranks.length - 1];
  return entry.icon ? `<img class="icon" src="icons/${entry.icon}.png" alt="${esc(base)}">` : '';
}

function parseAbilities(abilitiesStr) {
  // "Bite 7, Cower 5" → [{name:"Bite", rank:7}, {name:"Cower", rank:5}]
  if (!abilitiesStr || abilitiesStr === 'None') return [];
  return abilitiesStr.split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const m = s.match(/^(.+?)\s+(\d+)$/);
    return m ? { name: m[1], rank: parseInt(m[2]), raw: s } : { name: s, rank: null, raw: s };
  });
}

function abilitySpanWithTooltip(ability) {
  const base = ability.name;
  const ranks = state.spells[base];
  if (!ranks?.length) return esc(ability.raw);

  const rank = ability.rank ? ranks.find(r => r.rank === ability.rank) || ranks[ranks.length - 1] : ranks[0];
  const icon = rank.icon || ranks[ranks.length - 1].icon;
  const iconHtml = icon ? `<img class="icon" src="icons/${icon}.png" alt="${esc(base)}">` : '';

  const ttLines = [
    `<div class="att-name">${esc(rank.description ? base : ability.raw)}${ability.rank ? ` Rank ${ability.rank}` : ''}</div>`,
    rank.cost ? `<div class="att-cost">${esc(rank.cost)}</div>` : '',
    rank.range ? `<div class="att-range">${esc(rank.range)}</div>` : '',
    rank.castTime ? `<div class="att-cast">${esc(rank.castTime)}</div>` : '',
    rank.cooldown && rank.cooldown !== 'n/a' ? `<div class="att-cd">${esc(rank.cooldown)} cooldown</div>` : '',
    rank.description ? `<div class="att-desc">${esc(rank.description)}</div>` : '',
  ].filter(Boolean).join('');

  return `<span class="ability-hover" data-tooltip="${esc(ttLines)}">${iconHtml}${esc(ability.raw)}</span>`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  TAB SWITCHING
// ══════════════════════════════════════════════════════════════════════════════

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    // Re-render map dots on tab switch (sizing may have changed)
    if (btn.dataset.tab === 'map' && state.currentWma) {
      setTimeout(() => renderDots(state.currentWma), 50);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  BOOT — Load data
// ══════════════════════════════════════════════════════════════════════════════

async function boot() {
  let zonesData, beastsPayload, familiesData, spellsData;
  try {
    [zonesData, beastsPayload, familiesData, spellsData] = await Promise.all([
      fetch('data/zones.json').then(r => r.json()),
      fetch('data/beasts.json').then(r => r.json()),
      fetch('data/families.json').then(r => r.json()).catch(() => ({})),
      fetch('data/spells.json').then(r => r.json()).catch(() => ({})),
    ]);
  } catch (err) {
    document.getElementById('details').textContent =
      'Failed to load data. Run: python3 .tools/build_data.py';
    return;
  }

  state.zones = zonesData;
  state.beasts = beastsPayload.beasts || [];
  state.beasts.forEach(b => { state.beastsById[b.npcId] = b; });
  state.families = familiesData;
  state.spells = spellsData;
  // Check URL hash for deep link
  const hashMatch = location.hash.match(/^#beast\/(\d+)$/);
  const hashNpcId = hashMatch ? Number(hashMatch[1]) : null;
  state.selectedNpcId = (hashNpcId && beastsPayload.beasts?.some(b => b.npcId === hashNpcId))
    ? hashNpcId
    : null;

  // Meta info
  document.getElementById('meta').textContent =
    `Generated: ${fmtDate(beastsPayload.generatedAt)} | ${beastsPayload.totalBeasts ?? state.beasts.length} beasts`;

  // Beast browser init
  buildFamilyOptions();
  bindBrowserEvents();
  applyFilters();

  // Pet families init
  renderFamiliesTable();
  bindFamiliesEvents();

  // Map viewer init
  buildSidebar();
  bindMapEvents();
}

// ══════════════════════════════════════════════════════════════════════════════
//  BEAST BROWSER — Filters, Table, Details
// ══════════════════════════════════════════════════════════════════════════════

const el = {
  searchInput:   () => document.getElementById('searchInput'),
  familyFilter:  () => document.getElementById('familyFilter'),
  rankFilter:    () => document.getElementById('rankFilter'),
  levelMin:      () => document.getElementById('levelMin'),
  levelMax:      () => document.getElementById('levelMax'),
  resetFilters:  () => document.getElementById('resetFilters'),
  resultCount:   () => document.getElementById('resultCount'),
  beastsTbody:   () => document.getElementById('beastsTbody'),
  details:       () => document.getElementById('details'),
};

function buildFamilyOptions() {
  const families = [...new Set(state.beasts.map(b => b.family).filter(Boolean))].sort();
  const sel = el.familyFilter();
  for (const f of families) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = f;
    sel.appendChild(opt);
  }
}

function matchesLevel(beast, minLvl, maxLvl) {
  const bMin = typeof beast.levelMin === 'number' ? beast.levelMin : null;
  const bMax = typeof beast.levelMax === 'number' ? beast.levelMax : null;
  if (minLvl !== null && bMax !== null && bMax < minLvl) return false;
  if (maxLvl !== null && bMin !== null && bMin > maxLvl) return false;
  return true;
}

function applyFilters() {
  const query   = el.searchInput().value.trim().toLowerCase();
  const family  = el.familyFilter().value;
  const rank    = el.rankFilter().value;
  const minLvl  = el.levelMin().value ? Number(el.levelMin().value) : null;
  const maxLvl  = el.levelMax().value ? Number(el.levelMax().value) : null;

  state.filtered = state.beasts.filter(beast => {
    if (family && beast.family !== family) return false;
    if (rank && (beast.rank || 'normal') !== rank) return false;
    if (!matchesLevel(beast, minLvl, maxLvl)) return false;
    if (!query) return true;

    const haystack = [
      beast.name, beast.family, beast.abilities, beast.rank, beast.level,
      String(beast.npcId), ...(beast.zoneNames || []),
    ].join(' ').toLowerCase();

    return haystack.includes(query);
  });

  state.filtered.sort((a, b) => {
    const d = (a.levelMin ?? 999) - (b.levelMin ?? 999);
    return d !== 0 ? d : a.name.localeCompare(b.name);
  });

  renderTable();
  if (state.selectedNpcId != null && !state.filtered.some(b => b.npcId === state.selectedNpcId)) {
    state.selectedNpcId = null;
  }
  renderDetails();
}

function renderTable() {
  const tbody = el.beastsTbody();
  tbody.innerHTML = state.filtered.map(beast => {
    const sel = beast.npcId === state.selectedNpcId ? ' selected' : '';
    const abilities = parseAbilities(beast.abilities);
    const abilityHtml = abilities.length
      ? abilities.map(a => abilitySpanWithTooltip(a)).join(', ')
      : '—';
    return `<tr class="row-clickable${sel}" data-npc-id="${beast.npcId}">
      <td>${esc(asText(beast.name))}</td>
      <td>${familyIcon(beast.family)} ${esc(asText(beast.family))}</td>
      <td>${esc(asText(beast.level))}</td>
      <td>${esc(asText(beast.rank || 'normal'))}</td>
      <td>${abilityHtml}</td>
      <td>${esc(asText(beast.spawnCount))}</td>
      <td>${esc((beast.zoneNames || []).join(', ') || '—')}</td>
    </tr>`;
  }).join('');

  el.resultCount().textContent = `${state.filtered.length} / ${state.beasts.length} beasts`;

  tbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', () => {
      state.selectedNpcId = Number(row.dataset.npcId);
      renderTable();
      renderDetails();
    });
  });

  bindAbilityTooltips(tbody);
}

function updateHash() {
  if (state.selectedNpcId != null) {
    history.replaceState(null, '', `#beast/${state.selectedNpcId}`);
  }
}

function renderDetails() {
  const beast = state.beastsById[state.selectedNpcId];
  const det = el.details();
  if (!beast) { det.textContent = 'No beast selected.'; return; }

  updateHash();

  const spawns = (beast.coords || []).map((c, i) => {
    const zName = state.zones[String(c.zoneId)] || c.zoneId;
    return `<tr>
      <td>${i + 1}</td>
      <td><span class="zone-link" data-wma="${c.zoneId}">${esc(zName)}</span></td>
      <td>${esc(asText(c.x))}</td>
      <td>${esc(asText(c.y))}</td>
    </tr>`;
  }).join('');

  const abilities = parseAbilities(beast.abilities);
  const abilityHtml = abilities.length
    ? abilities.map(a => abilitySpanWithTooltip(a)).join(', ')
    : '—';

  det.innerHTML = `
    <div class="beast-header">
      <div class="kv">
        <div class="k">Name</div><div>${esc(asText(beast.name))} <button class="copy-link-btn" title="Copy link to this beast">🔗</button></div>
        <div class="k">NPC ID</div><div><a href="https://database.turtlecraft.gg/?npc=${beast.npcId}" target="_blank" rel="noopener" class="db-link">${esc(asText(beast.npcId))}</a></div>
        <div class="k">Family</div><div>${familyIcon(beast.family)} ${esc(asText(beast.family))}</div>
        <div class="k">Level</div><div>${esc(asText(beast.level))}</div>
        <div class="k">Rank</div><div>${esc(asText(beast.rank || 'normal'))}</div>
        <div class="k">Abilities</div><div>${abilityHtml}</div>
      <div class="k">Respawn</div><div>${fmtRespawn(beast.respawnMinSeconds, beast.respawnMaxSeconds)}</div>
      <div class="k">Attack Speed</div><div>${esc(asText(beast.attackSpeed))}</div>
      <div class="k">Health</div><div>${esc(asText(beast.health))}</div>
      <div class="k">Armor</div><div>${esc(asText(beast.armor))}</div>
      <div class="k">Damage</div><div>${fmtDmg(beast.dmgMin)} – ${fmtDmg(beast.dmgMax)}</div>
      <div class="k">Spawns</div><div>${esc(asText(beast.spawnCount))}</div>
    </div>
      <div id="model-viewer-container" class="model-viewer-box"></div>
    </div>
    <div id="detail-maps"></div>
    <table class="spawn-table">
      <thead><tr><th>#</th><th>Zone</th><th>X</th><th>Y</th></tr></thead>
      <tbody>${spawns || '<tr><td colspan="4">No spawn coordinates</td></tr>'}</tbody>
    </table>`;

  // Copy link button
  det.querySelector('.copy-link-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const url = `${location.origin}${location.pathname}#beast/${beast.npcId}`;
    navigator.clipboard.writeText(url).then(() => {
      const btn = e.target;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '🔗'; }, 1500);
    });
  });

  // Zone links → switch to map tab and open that zone
  det.querySelectorAll('.zone-link').forEach(link => {
    link.addEventListener('click', () => {
      const wma = link.dataset.wma;
      switchToMap(wma);
    });
  });

  // Render mini maps with spawn markers (into the placeholder above the spawn table)
  renderDetailMaps(beast, det.querySelector('#detail-maps'));

  // Bind ability tooltips in detail panel
  bindAbilityTooltips(det);

  // Load 3D model if available (retry until model-viewer module is ready)
  if (beast.displayId) {
    const tryLoad = () => {
      if (window.loadBeastModel) {
        window.loadBeastModel(beast.displayId);
      } else {
        setTimeout(tryLoad, 100);
      }
    };
    requestAnimationFrame(tryLoad);
  }
}

function placeDots(panel) {
  if (!panel._imgLoaded) return;
  const img = panel.querySelector('.detail-map-img');
  const svg = panel.querySelector('.detail-map-svg');
  if (!img || !svg || img.clientWidth === 0) return;
  svg.innerHTML = '';
  const scaleX = img.clientWidth  / MAP_W;
  const scaleY = img.clientHeight / MAP_H;
  const color = familyColor(panel._beast.family);
  for (const pt of panel._pts) {
    const cx = (pt.x / 100 * MAP_W) * scaleX;
    const cy = (pt.y / 100 * MAP_H) * scaleY;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', 5);
    circle.setAttribute('fill', color);
    circle.setAttribute('fill-opacity', '0.9');
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', '1.2');
    circle.style.pointerEvents = 'all';
    circle.style.cursor = 'default';
    circle.addEventListener('mouseenter', e => {
      tooltip.innerHTML = `<strong>(${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})</strong>`;
      tooltip.style.display = 'block';
      moveTooltip(e);
    });
    circle.addEventListener('mousemove', moveTooltip);
    circle.addEventListener('mouseleave', hideTooltip);
    svg.appendChild(circle);
  }
}

function renderDetailMaps(beast, container) {
  const coords = beast.coords || [];
  if (!coords.length) return;

  // Group coords by zone
  const byZone = {};
  for (const c of coords) {
    if (!byZone[c.zoneId]) byZone[c.zoneId] = [];
    byZone[c.zoneId].push(c);
  }

  const zoneEntries = Object.entries(byZone);
  const useTabs = zoneEntries.length > 1;

  // Build tab bar if multiple zones
  let tabBar;
  if (useTabs) {
    tabBar = document.createElement('div');
    tabBar.className = 'detail-map-tabs';
    container.appendChild(tabBar);
  }

  const panels = [];

  for (let idx = 0; idx < zoneEntries.length; idx++) {
    const [zoneId, pts] = zoneEntries[idx];
    const zoneName = state.zones[String(zoneId)] || `Zone ${zoneId}`;

    // Tab button
    if (useTabs) {
      const btn = document.createElement('button');
      btn.className = 'detail-map-tab' + (idx === 0 ? ' active' : '');
      btn.textContent = zoneName;
      btn.addEventListener('click', () => {
        tabBar.querySelectorAll('.detail-map-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        panels.forEach((p, i) => {
          p.style.display = i === idx ? '' : 'none';
          if (i === idx) placeDots(p);
        });
      });
      tabBar.appendChild(btn);
    }

    const panel = document.createElement('div');
    panel.className = 'detail-map-panel';
    panel._pts = pts;
    panel._beast = beast;
    panel._imgLoaded = false;
    if (useTabs && idx !== 0) panel.style.display = 'none';

    const heading = document.createElement('div');
    heading.className = 'detail-map-heading';
    heading.innerHTML = `<span class="zone-link" data-wma="${zoneId}">${esc(zoneName)}</span> <span class="detail-map-count">(${pts.length} spawn${pts.length > 1 ? 's' : ''})</span>`;
    heading.querySelector('.zone-link').addEventListener('click', () => switchToMap(zoneId));
    panel.appendChild(heading);

    const wrap = document.createElement('div');
    wrap.className = 'detail-map-wrap';

    const img = document.createElement('img');
    img.className = 'detail-map-img';
    img.alt = zoneName;
    img.src = `maps/${zoneId}.png`;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('detail-map-svg');

    img.onload = () => {
      panel._imgLoaded = true;
      placeDots(panel);
    };

    img.onerror = () => { panel.remove(); };

    wrap.appendChild(img);
    wrap.appendChild(svg);
    panel.appendChild(wrap);
    container.appendChild(panel);
    panels.push(panel);
  }
}

function bindBrowserEvents() {
  [el.searchInput(), el.familyFilter(), el.rankFilter(), el.levelMin(), el.levelMax()]
    .forEach(e => e.addEventListener('input', applyFilters));

  el.resetFilters().addEventListener('click', () => {
    el.searchInput().value = '';
    el.familyFilter().value = '';
    el.rankFilter().value = '';
    el.levelMin().value = '';
    el.levelMax().value = '';
    applyFilters();
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  PET FAMILIES — Table
// ══════════════════════════════════════════════════════════════════════════════

function buildFamilyStats() {
  // Compute beast count and coord count per family from live data
  const counts = {};
  const coords = {};
  for (const b of state.beasts) {
    const f = b.family || 'Unknown';
    counts[f] = (counts[f] || 0) + 1;
    coords[f] = (coords[f] || 0) + (b.coords?.length || 0);
  }
  // Build unique ability set
  const abilityFamilies = {};
  for (const [name, fam] of Object.entries(state.families)) {
    for (const ab of fam.abilities || []) {
      if (!abilityFamilies[ab]) abilityFamilies[ab] = [];
      abilityFamilies[ab].push(name);
    }
  }
  const uniqueAbilities = new Set(
    Object.entries(abilityFamilies).filter(([, fams]) => fams.length === 1).map(([ab]) => ab)
  );
  return { counts, coords, uniqueAbilities };
}

function renderFamiliesTable() {
  const { counts, coords, uniqueAbilities } = buildFamilyStats();
  const asPercent = document.getElementById('statPercent')?.checked;
  const tbody = document.getElementById('familiesTbody');

  const families = Object.entries(state.families)
    .sort((a, b) => a[0].localeCompare(b[0]));

  tbody.innerHTML = families.map(([name, fam]) => {
    const icon = fam.icon ? `<img class="icon" src="icons/${fam.icon}.png" alt="${esc(name)}">` : '';

    // Abilities — filter out universal (Growl, Cower), unique first, then rest
    const UNIVERSAL = new Set(['Growl', 'Cower']);
    const filtered = (fam.abilities || []).filter(a => !UNIVERSAL.has(a));
    const unique = filtered.filter(a => uniqueAbilities.has(a)).sort();
    const common = filtered.filter(a => !uniqueAbilities.has(a)).sort();
    const sortedAbilities = [...unique, ...common];
    const abilitiesHtml = sortedAbilities.map(ab => {
      const isUnique = uniqueAbilities.has(ab);
      const ranks = state.spells[ab];
      // Find first rank that has an icon
      const abIcon = ranks?.length ? (ranks.find(r => r.icon)?.icon || '') : '';
      const iconHtml = abIcon ? `<img class="icon" src="icons/${abIcon}.png" alt="${esc(ab)}">` : '';
      // Tooltip data
      let ttLines = `<div class="att-name">${esc(ab)}</div>`;
      if (ranks?.length) {
        const trainable = ranks.filter(r => r.rank > 0);
        if (trainable.length) {
          ttLines += `<div class="att-range">Ranks ${trainable[0].rank}–${trainable[trainable.length - 1].rank}</div>`;
        }
        const desc = trainable[trainable.length - 1]?.description || ranks[ranks.length - 1]?.description;
        if (desc) ttLines += `<div class="att-desc">${esc(desc)}</div>`;
      }
      if (isUnique) ttLines += `<div class="att-cost" style="color:var(--text-gold)">Family unique</div>`;

      return `<span class="ability-chip ability-hover" data-tooltip="${esc(ttLines)}">${iconHtml}${esc(ab)}</span>`;
    }).join('');

    // Diet — capitalize, exclude "raw meat"/"raw fish", pipe-separated
    const display = (fam.food || [])
      .filter(f => f !== 'raw meat' && f !== 'raw fish')
      .map(f => f.charAt(0).toUpperCase() + f.slice(1));
    const dietHtml = esc(display.join(' | '));

    // Stats — color coded
    const stats = fam.stats || {};
    const fmtStat = (val) => {
      if (val === undefined || val === null) return `<td class="col-stat stat-blue">—</td>`;
      const cls = val > 1 ? 'stat-green' : val < 1 ? 'stat-red' : 'stat-blue';
      const txt = asPercent ? `${Math.round(val * 100)}%` : val;
      return `<td class="col-stat ${cls}">${txt}</td>`;
    };

    return `<tr class="row-clickable" data-family="${esc(name)}">
      <td class="col-family">${icon} ${esc(name)}</td>
      <td class="col-beasts">${counts[name] || 0}</td>
      <td class="col-coords">${coords[name] || 0}</td>
      <td class="col-abilities">${abilitiesHtml}</td>
      <td class="col-diet">${dietHtml}</td>
      ${fmtStat(stats.health)}
      ${fmtStat(stats.damage)}
      ${fmtStat(stats.armor)}
    </tr>`;
  }).join('');

  document.getElementById('familyCount').textContent = `${families.length} families`;

  // Click row → switch to Beast Browser filtered to that family
  tbody.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', () => {
      const family = row.dataset.family;
      // Switch to browser tab with family filter
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      document.querySelector('[data-tab="browser"]').classList.add('active');
      document.getElementById('tab-browser').classList.add('active');
      el.familyFilter().value = family;
      applyFilters();
    });
  });

  bindAbilityTooltips(tbody);
}

function bindFamiliesEvents() {
  document.getElementById('statPercent')?.addEventListener('change', renderFamiliesTable);
}

// ══════════════════════════════════════════════════════════════════════════════
//  ZONE MAP VIEWER — Sidebar, Map, Dots
// ══════════════════════════════════════════════════════════════════════════════

function buildSidebar(filter = '') {
  const list = document.getElementById('zone-list');
  list.innerHTML = '';
  const f = filter.toLowerCase();

  const entries = Object.entries(state.zones)
    .filter(([id, name]) => !HIDDEN_WMAS.has(parseInt(id)) && name.toLowerCase().includes(f))
    .sort((a, b) => a[1].localeCompare(b[1]));

  for (const [id, name] of entries) {
    const div = document.createElement('div');
    div.className = 'zone-item' + (id == state.currentWma ? ' active' : '');
    div.innerHTML = `${esc(name)}<span class="wma-id">${id}</span>`;
    div.dataset.wma = id;
    div.addEventListener('click', () => selectZone(id));
    list.appendChild(div);
  }
}

function bindMapEvents() {
  document.getElementById('zoneSearch').addEventListener('input', e => {
    buildSidebar(e.target.value);
  });

  window.addEventListener('resize', () => {
    if (state.currentWma) renderDots(state.currentWma);
  });
}

function selectZone(wmaId) {
  state.currentWma = wmaId;

  document.querySelectorAll('.zone-item').forEach(el => {
    el.classList.toggle('active', el.dataset.wma == wmaId);
  });

  const name = state.zones[wmaId] || `WMA ${wmaId}`;
  document.getElementById('map-title').textContent = `${name}  (WMA ${wmaId})`;

  const img = document.getElementById('map-img');
  const placeholder = document.getElementById('placeholder');
  const mapContainer = document.getElementById('map-container');

  placeholder.style.display = 'none';
  mapContainer.style.display = 'block';

  img.src = `maps/${wmaId}.png`;
  img.onerror = () => {
    img.style.display = 'none';
    mapContainer.style.cssText = 'display:block; position:relative; width:1002px; height:668px; background:#2a2f3a;';
    renderDots(wmaId);
  };
  img.onload = () => {
    img.style.display = '';
    mapContainer.style.cssText = '';
    renderDots(wmaId);
  };
}

function renderDots(wmaId) {
  const wmaInt = parseInt(wmaId);
  const img    = document.getElementById('map-img');
  const svg    = document.getElementById('map-svg');
  const legend = document.getElementById('legend');

  const scaleX = img.clientWidth  / MAP_W;
  const scaleY = img.clientHeight / MAP_H;

  svg.innerHTML = '';
  legend.innerHTML = '';

  const familiesSeen = {};
  const dots = [];

  for (const beast of state.beasts) {
    for (const c of beast.coords) {
      if (c.zoneId === wmaInt) {
        dots.push({ x: c.x, y: c.y, beast });
      }
    }
  }

  for (const { x, y, beast } of dots) {
    const cx = (x / 100 * MAP_W) * scaleX;
    const cy = (y / 100 * MAP_H) * scaleY;
    const color = familyColor(beast.family);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', 5);
    circle.setAttribute('fill', color);
    circle.setAttribute('fill-opacity', '0.85');
    circle.setAttribute('stroke', '#000');
    circle.setAttribute('stroke-width', '0.8');
    circle.classList.add('dot');

    circle.addEventListener('mouseenter', e => showTooltip(e, beast));
    circle.addEventListener('mousemove', e => moveTooltip(e));
    circle.addEventListener('mouseleave', hideTooltip);

    // Click a dot → show beast in the map detail pane
    circle.addEventListener('click', () => {
      renderMapBeastDetail(beast);
    });

    svg.appendChild(circle);
    familiesSeen[beast.family] = color;
  }

  for (const [fam, color] of Object.entries(familiesSeen).sort()) {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `<div class="legend-dot" style="background:${color}"></div>${esc(fam)}`;
    legend.appendChild(item);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  MAP BEAST DETAIL PANE
// ══════════════════════════════════════════════════════════════════════════════

function buildBeastDetailHTML(beast) {
  const abilities = parseAbilities(beast.abilities);
  const abilityHtml = abilities.length
    ? abilities.map(a => abilitySpanWithTooltip(a)).join(', ')
    : '—';
  return `
    <div class="kv">
      <div class="k">Name</div><div>${esc(asText(beast.name))}</div>
      <div class="k">NPC ID</div><div><a href="https://database.turtlecraft.gg/?npc=${beast.npcId}" target="_blank" rel="noopener" class="db-link">${esc(asText(beast.npcId))}</a></div>
      <div class="k">Family</div><div>${familyIcon(beast.family)} ${esc(asText(beast.family))}</div>
      <div class="k">Level</div><div>${esc(asText(beast.level))}</div>
      <div class="k">Rank</div><div>${esc(asText(beast.rank || 'normal'))}</div>
      <div class="k">Abilities</div><div>${abilityHtml}</div>
      <div class="k">Health</div><div>${esc(asText(beast.health))}</div>
      <div class="k">Armor</div><div>${esc(asText(beast.armor))}</div>
      <div class="k">Damage</div><div>${esc(asText(beast.dmgMin))} – ${esc(asText(beast.dmgMax))}</div>
    </div>
    <div class="model-viewer-box"></div>`;
}

function renderMapBeastDetail(beast) {
  const det = document.getElementById('map-beast-details');
  if (!det) return;
  det.innerHTML = buildBeastDetailHTML(beast);
  bindAbilityTooltips(det);
  const mvBox = det.querySelector('.model-viewer-box');
  if (beast.displayId && window.loadBeastModelIn) {
    window.loadBeastModelIn(mvBox, beast.displayId);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  CROSS-NAVIGATION
// ══════════════════════════════════════════════════════════════════════════════

function switchToMap(wmaId) {
  // Activate map tab
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector('[data-tab="map"]').classList.add('active');
  document.getElementById('tab-map').classList.add('active');

  selectZone(String(wmaId));
}

// ══════════════════════════════════════════════════════════════════════════════
//  TOOLTIP
// ══════════════════════════════════════════════════════════════════════════════

const tooltip = document.getElementById('tooltip');

function showTooltip(e, beast) {
  const rank = beast.rank && beast.rank !== 'normal' ? `<br>Rank: ${esc(beast.rank)}` : '';
  const abilities = beast.abilities ? `<br>Abilities: ${esc(beast.abilities)}` : '';
  tooltip.innerHTML = `<strong>${esc(beast.name)}</strong>Family: ${esc(beast.family)}<br>Level: ${esc(beast.level)}${rank}${abilities}`;
  tooltip.style.display = 'block';
  moveTooltip(e);
}
function moveTooltip(e) {
  tooltip.style.left = (e.clientX + 14) + 'px';
  tooltip.style.top  = (e.clientY - 10) + 'px';
}
function hideTooltip() {
  tooltip.style.display = 'none';
}

function bindAbilityTooltips(container) {
  container.querySelectorAll('.ability-hover[data-tooltip]').forEach(el => {
    el.addEventListener('mouseenter', e => {
      tooltip.innerHTML = el.dataset.tooltip;
      tooltip.classList.add('ability-tooltip');
      tooltip.style.display = 'block';
      moveTooltip(e);
    });
    el.addEventListener('mousemove', moveTooltip);
    el.addEventListener('mouseleave', () => {
      tooltip.classList.remove('ability-tooltip');
      hideTooltip();
    });
  });
}

// ══════════════════════════════════════════════════════════════════════════════
//  START
// ══════════════════════════════════════════════════════════════════════════════

boot();
