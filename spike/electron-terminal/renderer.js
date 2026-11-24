// ATILACAK DENEME
/* global Terminal, FitAddon, WebglAddon */
const api = window.edi;
const tabsEl = document.getElementById('tabs');
const terminalsEl = document.getElementById('terminals');
const reposEl = document.getElementById('repos');
const repoHeaderEl = document.getElementById('repo-header');

const tabs = [];
let active = null;
let config;
let reposSeen = null;

const THEME = {
  background: '#1e2127', foreground: '#abb2bf', cursor: '#d7dae0', selectionBackground: '#3e4451',
  black: '#1e2127', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
  brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderTabs() {
  tabsEl.replaceChildren();
  tabs.forEach((tab, index) => {
    const isClaude = tab.proc === 'claude';
    const button = el('button', `tab${tab === active ? ' active' : ''}`);
    button.append(el('span', `icon${isClaude ? ' claude' : ''}`, isClaude ? '✻' : '$'), el('span', '', `${index + 1} · ${tab.proc || 'kabuk'}`));
    const close = el('span', 'close', '×');
    close.addEventListener('click', (event) => { event.stopPropagation(); api.kill(tab.id); });
    button.append(close);
    button.addEventListener('click', () => activate(tab));
    tabsEl.append(button);
  });
  const addShell = el('button', 'add', '+ terminal');
  addShell.addEventListener('click', () => newTab());
  const addClaude = el('button', 'add');
  addClaude.append(el('span', 'icon claude', '✻'), el('span', '', '+ claude'));
  addClaude.addEventListener('click', () => newTab('claude'));
  tabsEl.append(addShell, addClaude);
}

function activate(tab) {
  active = tab;
  for (const other of tabs) other.host.classList.toggle('active', other === tab);
  renderTabs();
  if (!tab) return;
  fit(tab);
  tab.term.focus();
}

function fit(tab) {
  if (!tab || !tab.host.classList.contains('active')) return;
  tab.fit.fit();
  api.resize(tab.id, tab.term.cols, tab.term.rows);
}

async function newTab(command) {
  const host = el('div', 'term active');
  for (const other of tabs) other.host.classList.remove('active');
  terminalsEl.append(host);

  const term = new Terminal({
    fontFamily: "'SF Mono', Menlo, Monaco, monospace",
    fontSize: 13,
    lineHeight: 1.2,
    cursorBlink: true,
    scrollback: 10000,
    allowProposedApi: true,
    macOptionIsMeta: false, // Türkçe klavyede Option'lı karakterler (@ # { } [ ] | \ ~) yazılabilsin
    theme: THEME,
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(host);
  let renderer = 'dom';
  try {
    const webgl = new WebglAddon.WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    term.loadAddon(webgl);
    renderer = 'webgl';
  } catch {
    // WebGL yoksa DOM çizimiyle devam.
  }
  fitAddon.fit();

  const id = await api.createPty({ cols: term.cols, rows: term.rows, command });
  const tab = { id, term, fit: fitAddon, host, proc: '', renderer };
  tabs.push(tab);

  term.onData((data) => api.write(id, data));
  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;
    // Shift+Enter: Claude Code'da yeni satır (ESC + CR).
    if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); api.write(id, '\x1b\r'); return false; }
    if (event.metaKey && event.key === 't') { event.preventDefault(); newTab(); return false; }
    if (event.metaKey && event.key === 'w') { event.preventDefault(); api.kill(id); return false; }
    if (event.metaKey && /^[1-9]$/.test(event.key)) {
      const target = tabs[Number(event.key) - 1];
      if (target) activate(target);
      event.preventDefault();
      return false;
    }
    return true;
  });

  activate(tab);
  return tab;
}

api.on('pty:data', (id, data) => {
  const tab = tabs.find((candidate) => candidate.id === id);
  if (!tab) return;
  tab.term.write(data);
  if (tab.onData) tab.onData(data);
});

api.on('pty:exit', (id) => {
  const index = tabs.findIndex((candidate) => candidate.id === id);
  if (index === -1) return;
  const [tab] = tabs.splice(index, 1);
  tab.term.dispose();
  tab.host.remove();
  if (active === tab) activate(tabs[Math.min(index, tabs.length - 1)] ?? null);
  else renderTabs();
});

api.on('pty:procs', (procs) => {
  let changed = false;
  for (const tab of tabs) {
    const proc = procs[tab.id] ?? '';
    if (proc !== tab.proc) { tab.proc = proc; changed = true; }
  }
  if (changed) renderTabs();
});

api.on('repos', ({ rows, rootSessions }) => {
  reposSeen = rows.length;
  const title = el('span', '', config.dir.replace(config.home, '~'));
  repoHeaderEl.replaceChildren(title);
  if (rootSessions > 0) repoHeaderEl.append(el('span', 'claude', `✻ ${rootSessions}`));

  reposEl.replaceChildren();
  for (const row of rows) {
    const repo = el('div', 'repo');
    const name = el('span', 'name');
    if (row.claude > 0) name.append(el('span', 'claude', row.claude > 1 ? `✻${row.claude} ` : '✻ '));
    name.append(row.name);
    const branch = el('span', 'branch', row.branch);
    const state = el('span', `state${row.changes.startsWith('●') ? ' dirty' : row.changes.startsWith('!') ? ' error' : ''}`);
    if (row.sync) state.append(el('span', 'sync', `${row.sync}  `));
    state.append(row.changes);
    repo.append(name, branch, state);
    reposEl.append(repo);
    for (const file of row.files.slice(0, 50)) {
      const line = el('div', 'file');
      const letter = file.kind === 'untracked' ? '?' : file.kind === 'conflicted' ? 'U' : file.y !== '.' ? file.y : file.x;
      line.append(el('span', 'letter', letter), file.path);
      if (file.kind === 'changed' && file.x !== '.') line.append(el('span', 'tag', file.y !== '.' ? '  [kısmen]' : '  [staged]'));
      reposEl.append(line);
    }
  }
});

new ResizeObserver(() => fit(active)).observe(terminalsEl);

(async () => {
  config = await api.config();
  const first = await newTab();

  if (config.smoke === 'claude') {
    const tab = await newTab('claude');
    const timer = setInterval(() => {
      if (tab.proc !== 'claude') return;
      clearInterval(timer);
      setTimeout(() => api.reportSmoke({ ok: true, proc: tab.proc, tabs: tabs.length, icon: tabsEl.querySelector('.tab.active .icon')?.textContent }), 4000);
    }, 300);
  } else if (config.smoke) {
    let seen = '';
    first.onData = (data) => {
      seen += data;
      // Çıktıda "42" ancak kabuk komutu gerçekten çalıştırdıysa görünür.
      if (!seen.includes('edi-spike-42') || reposSeen === null) return;
      first.onData = null;
      setTimeout(() => api.reportSmoke({ ok: true, renderer: first.renderer, cols: first.term.cols, rows: first.term.rows, proc: first.proc, repos: reposSeen, tabs: tabs.length }), 1500);
    };
    setTimeout(() => api.write(first.id, 'echo edi-spike-$((6*7))\r'), 1500);
  }
})();
