# edi — çoklu repo git TUI'si Implementation Plan

> **Not (2026-11-24):** Bu belgenin arayüz kısmı (Ink TUI) iptal edildi; yerini
> `docs/superpowers/specs/2026-11-24-edi-desktop-app-design.md` aldı. Git çekirdeğiyle
> ilgili kısımlar geçerlidir.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bir klasördeki tüm git repolarının durumunu tek terminal ekranında canlı gösteren ve oradan stage/commit/push/pull/fetch/branch/diff yaptıran `edi` komutunu yazmak.

**Architecture:** Üç katman. (1) `src/git/*`: `git` CLI'ını argüman dizisiyle çalıştıran, hiçbir zaman exception fırlatmayan saf Node katmanı. (2) `src/ui/rows.ts`: repo durumlarından ekrandaki satır listesini, imleci ve kaydırma penceresini üreten saf fonksiyonlar. (3) `src/ui/*.tsx`: Ink bileşenleri; durumu yoklayan bir hook ve mod bazlı tuş yönetimi.

**Tech Stack:** Node ≥ 22 (makinede 24), TypeScript (ESM, NodeNext), Ink 8 + React 19, Vitest, ink-testing-library, tsx. Git kütüphanesi yok.

**Spec:** `docs/superpowers/specs/2026-11-24-edi-multi-repo-git-tui-design.md`

## Global Constraints

- Çalışma zamanı bağımlılıkları yalnız `ink` ve `react`. Sürümler `npm install` ile en güncel alınır.
- Her git çağrısı `runGit(cwd, args[])` üzerinden gider; shell string'i yok, dosya yolları her zaman `--` sonrasında.
- Şu komutlar/bayraklar kodda hiçbir yerde geçmez: `reset --hard`, `checkout -- <yol>`, `clean`, `push --force*`, `rebase`, `--no-verify`, `fetch --prune`. (`git reset -q -- <yol>` yalnız index'e dokunur ve serbesttir.)
- Otomatik fetch/pull/push yok; yalnız tuşla.
- Arayüz metinleri Türkçe ve bu plandaki/spec'teki haliyle birebir.
- Testler yalnız geçici dizinlerde çalışır; `~/studios` altındaki gerçek repolara ve gerçek remote'lara dokunmaz (remote olarak yerel bare repo).
- Commit'ler Conventional Commits 1.0.0; her commit mesajının sonunda footer: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **Hiç commit'i olmayan repo:** branch adı görünür; unstage ve diff hata vermez. → Task 2, Task 3.
2. **Boşluklu/Türkçe karakterli yollar ve stage'li rename:** doğru ayrıştırılır; stage, unstage, diff çalışır. → Task 2, Task 3.
3. **Çalışırken silinen ya da bozulan repo:** yalnız o satır hata gösterir, diğerleri yenilenmeye devam eder, uygulama çökmez. → Task 5.
4. **Başka bir git süreci index'i kilitlemişken (`index.lock`) ya da aynı repoda işlem sürerken tuşa basmak:** hata satırda görünür, ikinci işlem kuyruğa alınmaz, yoklama sürer. → Task 3, Task 5, Task 6.
5. **Çok küçük terminal, sığmayan liste, binlerce satırlık diff:** yalnız görünen pencere çizilir, imleç görünür kalır. → Task 4, Task 8.

---

### Task 1: Proje iskeleti, `runGit`, repo keşfi

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/git/exec.ts`, `src/git/discover.ts`
- Test: `tests/helpers/tmpRepo.ts`, `tests/exec.test.ts`, `tests/discover.test.ts`

**Interfaces:**
- Produces:

```ts
// src/git/exec.ts
export type GitResult = { ok: true; stdout: string } | { ok: false; error: string; stdout: string };
export function runGit(cwd: string, args: string[], opts?: { timeoutMs?: number; okCodes?: number[] }): Promise<GitResult>;
export function pickErrorLine(stderr: string): string;
// src/git/discover.ts
export interface Repo { name: string; path: string }
export function discoverRepos(dir: string): Promise<Repo[]>;
// tests/helpers/tmpRepo.ts
export function makeTmpDir(): Promise<string>;   // realpath'li; afterEach'te silinir
export function initRepo(parent: string, name: string, opts?: { commit?: boolean }): Promise<string>; // branch main, yerel user.name/email; commit:true ise README ile ilk commit
export function git(cwd: string, ...args: string[]): Promise<string>;  // sıfır dışı çıkışta throw
export function addBareRemote(repoPath: string): Promise<string>;     // bare repo oluşturur, origin olarak ekler, yolunu döner
```

- [ ] **Step 1: İskeleti kur.** `package.json`: `"name": "edi"`, `"private": true`, `"type": "module"`, `"bin": { "edi": "dist/cli.js" }`, `"engines": { "node": ">=22" }`, scripts: `build` = `tsc`, `dev` = `tsx src/cli.tsx`, `test` = `vitest run`, `typecheck` = `tsc --noEmit`. `tsconfig.json`: `module`/`moduleResolution` `NodeNext`, `jsx` `react-jsx`, `strict`, `outDir` `dist`, `rootDir` `src`. `.gitignore`: `node_modules`, `dist`. Çalıştır: `npm install ink react && npm install -D typescript tsx vitest ink-testing-library @types/react @types/node`.

- [ ] **Step 2: Başarısız testleri yaz** (`tests/exec.test.ts`, `tests/discover.test.ts`):

```ts
it('runGit başarı', async () => expect(await runGit(repo, ['rev-parse', '--is-inside-work-tree'])).toEqual({ ok: true, stdout: 'true\n' }));
it('runGit repo olmayan dizin', async () => { const r = await runGit(plainDir, ['status']); expect(r.ok).toBe(false); expect(!r.ok && r.error).toMatch(/^fatal:/); });
it('runGit olmayan cwd throw etmez', async () => expect((await runGit('/yok/boyle/yer', ['status'])).ok).toBe(false));
it('runGit okCodes', async () => expect((await runGit(repo, ['diff', '--no-index', '--', '/dev/null', 'README.md'], { okCodes: [0, 1] })).ok).toBe(true));
it('pickErrorLine', () => {
  expect(pickErrorLine('hint: x\nerror: failed to push some refs\n')).toBe('error: failed to push some refs');
  expect(pickErrorLine(' ! [rejected] main -> main (fetch first)\nerror: failed\n')).toBe('! [rejected] main -> main (fetch first)');
  expect(pickErrorLine('foo\nbar\n')).toBe('bar');
  expect(pickErrorLine('')).toBe('git başarısız oldu');
});
// discover: parent içinde a (repo), b (düz klasör), c (.git DOSYASI olan klasör), dosya.txt
it('alt seviyedeki repoları ada göre listeler', async () => expect((await discoverRepos(parent)).map(r => r.name)).toEqual(['a', 'c']));
it('klasörün kendisi repoysa yalnız onu döner', async () => expect(await discoverRepos(repoA)).toEqual([{ name: 'a', path: repoA }]));
it('repo yoksa boş', async () => expect(await discoverRepos(emptyDir)).toEqual([]));
```

- [ ] **Step 3: Testlerin başarısız olduğunu gör.** Run: `npm test` → FAIL (modüller yok).

- [ ] **Step 4: `runGit` ve `pickErrorLine`'ı yaz.** `spawn('git', args, { cwd, detached: true, stdio: ['ignore','pipe','pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })`. `detached` kontrol terminalini koparır; böylece ssh/git parola sormak için terminali ele geçiremez, hızlıca hata verir. Varsayılan `timeoutMs` 15000; aşılırsa süreç grubunu öldür, `error: 'zaman aşımı'`. Spawn hatası dahil hiçbir durumda reject etmez. `pickErrorLine`: `fatal:` / `error:` ile başlayan ya da `[rejected]` içeren ilk satır (trim'li); yoksa son dolu satır; hiç yoksa `'git başarısız oldu'`.

- [ ] **Step 5: `discoverRepos`'u yaz.** `dir/.git` varsa `[{ name: basename(dir), path: dir }]`; yoksa `.git` (dosya ya da dizin) içeren doğrudan alt klasörler, `name`'e göre `localeCompare` sıralı. Okunamayan alt klasör atlanır.

- [ ] **Step 6: Testler geçsin.** Run: `npm test && npm run typecheck` → PASS.

- [ ] **Step 7: Commit.** `git add -A && git commit` — `build: scaffold project with git exec and repo discovery`

---

### Task 2: Durum okuma ve ayrıştırma

**Files:**
- Create: `src/git/status.ts`
- Test: `tests/status.test.ts`

**Interfaces:**
- Consumes: `runGit`, `GitResult` (Task 1).
- Produces:

```ts
export interface FileChange { path: string; origPath: string | null; x: string; y: string; kind: 'changed' | 'untracked' | 'conflicted' }
export interface RepoStatus { head: string; detached: boolean; unborn: boolean; upstream: string | null; ahead: number | null; behind: number | null; files: FileChange[] }
export function parseStatus(raw: string): RepoStatus;
export function getStatus(repoPath: string): Promise<{ ok: true; status: RepoStatus } | { ok: false; error: string }>;
export function isStaged(f: FileChange): boolean;     // kind === 'changed' && x !== '.'
export function hasUnstaged(f: FileChange): boolean;  // kind === 'untracked' || (kind === 'changed' && y !== '.')
export function isDeleted(f: FileChange): boolean;    // y === 'D' || (y === '.' && x === 'D')
export function statusLetter(f: FileChange): string;  // untracked '?', conflicted 'U', yoksa y !== '.' ? y : x
export function statusTag(f: FileChange): '' | '[staged]' | '[kısmen]';
```

- [ ] **Step 1: Başarısız testleri yaz.** Fixture'lar NUL ayraçlı gerçek çıktıdan (`H` = 40 haneli herhangi bir hash):

```ts
const hdr = '# branch.oid c8be86ca35d2184906225ab667c0025a8abfc51c\0# branch.head main\0';
it('upstream ve ahead/behind', () => expect(parseStatus(hdr + '# branch.upstream origin/main\0# branch.ab +1 -2\0')).toMatchObject({ head: 'main', upstream: 'origin/main', ahead: 1, behind: 2, files: [] }));
it('upstream yok', () => expect(parseStatus(hdr)).toMatchObject({ upstream: null, ahead: null, behind: null }));
it('detached', () => expect(parseStatus('# branch.oid c8be86ca35d2184906225ab667c0025a8abfc51c\0# branch.head (detached)\0')).toMatchObject({ head: 'c8be86c', detached: true }));
it('commit yok', () => expect(parseStatus('# branch.oid (initial)\0# branch.head main\0')).toMatchObject({ head: 'main', unborn: true }));
it('rename kaydı origPath alanını tüketir', () => {
  const s = parseStatus(hdr + `2 R. N... 100644 100644 100644 ${H} ${H} R100 yeni.txt\0boş dosya.txt\0? unt.txt\0`);
  expect(s.files).toEqual([
    { path: 'yeni.txt', origPath: 'boş dosya.txt', x: 'R', y: '.', kind: 'changed' },
    { path: 'unt.txt', origPath: null, x: '?', y: '?', kind: 'untracked' },
  ]);
});
it('boşluklu yol', () => expect(parseStatus(hdr + `1 .M N... 100644 100644 100644 ${H} ${H} a b/c d.txt\0`).files[0].path).toBe('a b/c d.txt'));
it('çakışma', () => expect(parseStatus(hdr + `u UU N... 100644 100644 100644 100644 ${H} ${H} ${H} x.txt\0`).files[0]).toMatchObject({ path: 'x.txt', kind: 'conflicted' }));
it('harf ve etiket', () => {
  const f = (x: string, y: string, kind: FileChange['kind'] = 'changed') => ({ path: 'p', origPath: null, x, y, kind });
  expect([statusLetter(f('.', 'M')), statusTag(f('.', 'M'))]).toEqual(['M', '']);
  expect([statusLetter(f('M', '.')), statusTag(f('M', '.'))]).toEqual(['M', '[staged]']);
  expect([statusLetter(f('A', 'M')), statusTag(f('A', 'M'))]).toEqual(['M', '[kısmen]']);
  expect(statusLetter(f('?', '?', 'untracked'))).toBe('?');
  expect(statusLetter(f('U', 'U', 'conflicted'))).toBe('U');
});
// gerçek repo
it('getStatus yeni dosyaları tek tek listeler', async () => { /* d/n.txt ve "boş dosya.txt" oluştur */ expect(paths).toEqual(['boş dosya.txt', 'd/n.txt']); });
it('getStatus commit'siz repoda çalışır', async () => expect(r.ok && r.status.unborn).toBe(true));
it('getStatus olmayan yolda ok:false', async () => expect((await getStatus('/yok')).ok).toBe(false));
```

- [ ] **Step 2: Başarısız olduğunu gör.** Run: `npx vitest run tests/status.test.ts` → FAIL.

- [ ] **Step 3: `parseStatus` ve yardımcıları yaz.** Kayıtlar NUL ile ayrılır. Yol: tür `1`'de 8., tür `2`'de 9., tür `u`'da 10. boşluktan sonraki her şey. Tür `2`'den sonraki NUL alanı `origPath`'tir. `!` kayıtları atlanır. Detached'te `head` = `branch.oid`'in ilk 7 hanesi. `branch.ab` yoksa `ahead`/`behind` `null`.

- [ ] **Step 4: `getStatus`'u yaz.** Komut: `git --no-optional-locks status --porcelain=v2 --branch -z --untracked-files=all`.

- [ ] **Step 5: Testler geçsin.** Run: `npm test && npm run typecheck` → PASS.

- [ ] **Step 6: Commit.** `feat: read and parse repository status`

---

### Task 3: Git işlemleri

**Files:**
- Create: `src/git/actions.ts`
- Test: `tests/actions.test.ts`

**Interfaces:**
- Consumes: `runGit` (Task 1); `FileChange`, `RepoStatus`, `getStatus` (Task 2).
- Produces:

```ts
export type ActionResult = { ok: true; message: string } | { ok: false; error: string };
export type DiffResult = { ok: true; text: string } | { ok: false; error: string };
export function stageFile(repo: string, f: FileChange): Promise<ActionResult>;   // git add -A -- <path>
export function unstageFile(repo: string, f: FileChange): Promise<ActionResult>; // git reset -q -- <path> [origPath]
export function stageAll(repo: string): Promise<ActionResult>;                   // git add -A
export function unstageAll(repo: string): Promise<ActionResult>;                 // git reset -q
export function commit(repo: string, message: string, opts: { addAll: boolean }): Promise<ActionResult>;
export function push(repo: string, status: RepoStatus): Promise<ActionResult>;
export function pull(repo: string): Promise<ActionResult>;                       // git pull --ff-only
export function fetchRepo(repo: string): Promise<ActionResult>;                  // git fetch
export function listBranches(repo: string): Promise<{ ok: true; branches: string[]; current: string | null } | { ok: false; error: string }>;
export function switchBranch(repo: string, name: string): Promise<ActionResult>; // git switch <name>
export function createBranch(repo: string, name: string): Promise<ActionResult>; // git switch -c <name>
export function diffFile(repo: string, status: RepoStatus, f: FileChange): Promise<DiffResult>;
export function diffRepo(repo: string, status: RepoStatus): Promise<DiffResult>;
```

Sabitler: `commit` boş/boşluk mesajda git çağırmadan `{ ok: false, error: 'commit mesajı boş' }`; `addAll` ise önce `git add -A`; sonra `git commit -m <mesaj>`, zaman aşımı 120000 (hook'lar yavaş olabilir). `push`: `status.detached` ise `{ ok: false, error: 'detached HEAD: push edilemez' }`; `status.upstream === null` ise `git push -u origin <head>`, değilse `git push`. Ağ komutlarında (`push`/`pull`/`fetch`) zaman aşımı 60000. `listBranches`: `git for-each-ref --format=%(refname:short) refs/heads` + `git symbolic-ref --short -q HEAD`. Diff tabanı: `status.unborn ? '4b825dc642cb6eb9a060e54bf8d69288fbee4904' : 'HEAD'`; tüm diff'lerde `--no-color --no-ext-diff -M`. Yeni dosya: `git diff --no-color --no-index -- /dev/null <path>` (`okCodes: [0, 1]`). `diffRepo` = tabana göre diff + her yeni dosyanın diff'i art arda.

- [ ] **Step 1: Başarısız testleri yaz.** Her biri geçici repoda; durum `getStatus` ile, geçmiş `git(...)` yardımcısıyla doğrulanır:

```ts
it('dosya stage/unstage ("boş dosya.txt")');             // x: '.'→'A'→ tekrar untracked
it('commit'siz repoda unstage çalışır');                 // ok: true, dosya yine untracked
it('stage'li rename unstage edilince stage'li kayıt kalmaz'); // files.every(f => !isStaged(f))
it('stageAll / unstageAll');
it('commit yalnız stage'lileri alır');                   // log -1 %s === 'feat: x'; diğer dosya hâlâ ' M'
it('commit addAll yeni dosyayı da alır');                // status.files.length === 0
it('boş mesaj commit etmez');                            // error 'commit mesajı boş', rev-list --count değişmez
it('commit edilecek bir şey yokken ok:false');
it('reddeden pre-commit hook: ok:false, HEAD değişmez'); // .git/hooks/pre-commit: echo "lint failed" >&2; exit 1
it('index.lock varken stageFile ok:false, getStatus ok:true'); // error içinde 'index.lock'
it('upstream'siz push origin'e -u ile gider');           // sonrasında status.upstream === 'origin/main', ahead 0
it('origin yokken push ok:false'); it('detached push ok:false');
it('pull fast-forward eder');                            // ikinci klon push'lar; pull sonrası HEAD === origin/main
it('ayrışmış geçmişte pull ok:false, HEAD değişmez');
it('fetch sonrası behind 1');
it('listBranches', async () => expect(r).toEqual({ ok: true, branches: ['feat/x', 'main'], current: 'main' }));
it('switchBranch / createBranch');                       // status.head
it('çakışan değişiklikle switch ok:false, branch aynı');
it('diffFile değişen dosya', async () => expect(text).toContain('+yeni satır'));
it('diffFile yeni dosya', async () => expect(text).toContain('+++ b/unt.txt'));
it('diffFile commit'siz repoda stage'li dosya', async () => expect(r.ok).toBe(true));
it('diffRepo izlenen ve yeni dosyaları birlikte verir');
it('color.ui=always ve diff.external ayarlıyken diff düz metindir', async () => expect(text).not.toContain('\u001B['));
```

- [ ] **Step 2: Başarısız olduğunu gör.** Run: `npx vitest run tests/actions.test.ts` → FAIL.
- [ ] **Step 3: `src/git/actions.ts`'i yukarıdaki imza ve sabitlerle yaz.** Başarı mesajları kısa Türkçe: `'stage edildi'`, `'unstage edildi'`, `'commit edildi'`, `'push edildi'`, `'pull edildi'`, `'fetch edildi'`, `'<name> branch'ine geçildi'`. Hata = `runGit`'in `error`'ı.
- [ ] **Step 4: Testler geçsin.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Yasaklı komut taraması.** Run: `grep -rnE "reset --hard|--force|--no-verify|--prune|'clean'|'rebase'" src/` → çıktı yok.
- [ ] **Step 6: Commit.** `feat: add stage, commit, sync, branch and diff operations`

---

### Task 4: Satır modeli (saf)

**Files:**
- Create: `src/ui/rows.ts`
- Test: `tests/rows.test.ts`

**Interfaces:**
- Consumes: `Repo` (Task 1); `RepoStatus`, `FileChange` (Task 2).
- Produces:

```ts
export interface RepoState { status: RepoStatus | null; error: string | null; busy: string | null }
export type Row =
  | { type: 'repo'; key: string; repo: Repo; state: RepoState; expanded: boolean }
  | { type: 'file'; key: string; repo: Repo; file: FileChange };
export function buildRows(repos: Repo[], states: Record<string, RepoState>, overrides: Record<string, boolean>): Row[];
export function resolveCursor(rows: Row[], prevKey: string | null, prevIndex: number): number;
export function windowTop(count: number, cursor: number, height: number, prevTop: number): number;
export function repoSummary(state: RepoState): { branch: string; sync: string; changes: string };
```

Kurallar: repo satırı `key` = `repo.path`; dosya satırı `key` = `repo.path + '\0' + file.path`. `expanded` = `overrides[repo.path] ?? (dosya sayısı > 0)`. `resolveCursor`: `prevKey` hâlâ varsa onun indeksi; yoksa `prevIndex`'i `[0, rows.length - 1]`'e sıkıştır. `windowTop`: imleç pencere içindeyse `prevTop` korunur, değilse en az kaydırma; `height < 1` → 1 sayılır; sonuç `[0, max(0, count - height)]`. `repoSummary`: `status === null` ise `changes` = hata varsa `'! ' + error`, yoksa `'yükleniyor…'`; `branch` = `status.head`; `sync` = detached ise `''`, upstream yoksa `'upstream yok'`, varsa sıfır olmayanlarla `'↓2 ↑1'` (ikisi de 0 ise `''`); `changes` = `busy ?? (n > 0 ? '● n değişiklik' : '✓ temiz')`.

- [ ] **Step 1: Başarısız testleri yaz:**

```ts
it('temiz repo kapalı, değişiklikli repo açık gelir');     // satır türleri: ['repo','repo','file','file']
it('override varsayılanı ezer');                          // { [dirty.path]: false } → dosya satırı yok
it('resolveCursor anahtarı izler');                       // araya satır girince aynı dosyada kalır
it('resolveCursor anahtar kaybolunca sıkıştırır', () => expect(resolveCursor(rows3, 'yok', 9)).toBe(2));
it('windowTop', () => {
  expect(windowTop(100, 99, 3, 0)).toBe(97);
  expect(windowTop(100, 5, 10, 2)).toBe(2);
  expect(windowTop(100, 1, 10, 2)).toBe(1);
  expect(windowTop(3, 2, 10, 0)).toBe(0);
  expect(windowTop(100, 7, 0, 0)).toBe(7);
});
it('repoSummary', () => {
  expect(repoSummary(st({ head: 'main', upstream: 'origin/main', ahead: 1, behind: 2, files: [f, f, f] }))).toEqual({ branch: 'main', sync: '↓2 ↑1', changes: '● 3 değişiklik' });
  expect(repoSummary(st({ upstream: null, ahead: null, behind: null })).sync).toBe('upstream yok');
  expect(repoSummary(st({ upstream: 'origin/main', ahead: 0, behind: 0 }))).toMatchObject({ sync: '', changes: '✓ temiz' });
  expect(repoSummary({ status: null, error: 'fatal: not a git repository', busy: null }).changes).toBe('! fatal: not a git repository');
  expect(repoSummary({ ...st({}), busy: 'push ediliyor…' }).changes).toBe('push ediliyor…');
});
```

- [ ] **Step 2: Başarısız olduğunu gör.** Run: `npx vitest run tests/rows.test.ts` → FAIL.
- [ ] **Step 3: `src/ui/rows.ts`'i yaz.**
- [ ] **Step 4: Testler geçsin.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit.** `feat: add row model, cursor tracking and scroll window`

---

### Task 5: Uygulama kabuğu — liste, yoklama, gezinme, Zed'de açma

**Files:**
- Create: `src/cli.tsx`, `src/ui/App.tsx`, `src/ui/useRepos.ts`, `src/ui/RepoList.tsx`, `src/zed.ts`
- Test: `tests/helpers/ui.ts`, `tests/app-shell.test.tsx`, `tests/useRepos.test.tsx`, `tests/zed.test.ts`

**Interfaces:**
- Consumes: `discoverRepos`, `Repo` (Task 1); `getStatus`, `isDeleted`, `statusLetter`, `statusTag` (Task 2); `ActionResult` (Task 3); Task 4'ün tümü.
- Produces:

```ts
// src/zed.ts
export function zedCandidates(file: string, zedOnPath: boolean): { cmd: string; args: string[] }[];
export function openInZed(file: string): Promise<ActionResult>;
// src/ui/useRepos.ts
export function useRepos(dir: string, pollMs: number): {
  repos: Repo[]; states: Record<string, RepoState>; lastRefresh: number | null;
  rescan(): Promise<void>; refresh(repoPath: string): Promise<void>;
  runAction(repo: Repo, busyLabel: string, fn: () => Promise<ActionResult>): Promise<ActionResult>;
};
// src/ui/App.tsx
export type Mode = { kind: 'list' };   // sonraki görevler bu birleşimi genişletir
export interface AppProps { dir: string; pollMs?: number; openFile?: (absPath: string) => Promise<ActionResult> }
export function App(props: AppProps): React.JSX.Element;
// tests/helpers/ui.ts
export function waitFor(check: () => boolean, timeoutMs?: number): Promise<void>;  // varsayılan 3000; süre dolarsa throw
export const keys: { up: string; down: string; enter: string; esc: string; space: string };
```

Sabitler:
- `useRepos`: repo başına önceki yoklama bitmeden yenisi başlamaz; durum değişmediyse state güncellenmez (titreme olmasın). `runAction`: repo meşgulse `fn` çağrılmadan `{ ok: false, error: '<repo.name>: başka bir işlem sürüyor' }`; değilse `busy` = etiket → `fn` → `busy` temizlenir → o repo hemen yenilenir → sonuç döner.
- `App`: `pollMs` varsayılan 2000, `openFile` varsayılan `openInZed`. `Mode` state'i tutar; liste tuşları yalnız `mode.kind === 'list'` iken işlenir. Bildirim satırı (`notice`) tutar: her `ActionResult`'ın `message`/`error`'ı oraya yazılır (hata kırmızı).
- Yerleşim (üstten alta): başlık `edi · <dir, ev dizini ~ ile>` + sağda `↻ N sn önce`; liste; ayırıcı; bildirim satırı; iki satır tuş yardımı (spec'teki metin birebir). Liste yüksekliği = terminal satırı − 5; `resize` olayında yeniden hesaplanır.
- Satır: imleçteki satır `›` ile başlar ve ters renklidir, diğerleri boşlukla. Repo satırı: `▾`/`▸`, ad, `repoSummary` alanları. Dosya satırı: girintili `statusLetter`, yol, `statusTag`. Uzun metin kırpılır (`wrap="truncate-end"`).
- Liste modu tuşları: `↑`/`k`, `↓`/`j`; `enter` (repo: aç/kapat ve override'a yaz; dosya: `isDeleted` ise bildirim `'dosya silinmiş'`, değilse `openFile(join(repo.path, file.path))`); `r` (`rescan`); `q` (çık). İmleç `resolveCursor` ile anahtara bağlıdır.
- `zedCandidates`: sırayla `{ cmd: 'zed' }` (yalnız `zedOnPath`), `{ cmd: '/Applications/Zed.app/Contents/MacOS/cli' }`, `{ cmd: 'open', args: ['-a', 'Zed', file] }`. `openInZed` sırayla dener; hepsi başarısızsa `{ ok: false, error: 'Zed açılamadı' }`.
- `cli.tsx`: `#!/usr/bin/env node`; argüman klasörü (yoksa `process.cwd()`), `realpath` ile çözülür (Task 9'daki oturum eşleştirmesi gerçek yollarla çalışır); klasör değilse stderr `edi: <yol> bir klasör değil`, çıkış kodu 1; repo yoksa `edi: <yol> altında git reposu yok`, çıkış kodu 1; değilse alternatif ekrana geç (`\x1b[?1049h`), `App`'i çiz, çıkışta geri dön (`\x1b[?1049l`).

- [ ] **Step 1: Başarısız testleri yaz** (gerçek geçici repolar, `pollMs: 50`, `openFile` sahte):

```tsx
it('repoları ve durumlarını gösterir');        // 'temiz-repo' satırında '✓ temiz'; 'kirli-repo' satırında '● 2 değişiklik' ve altında a.txt, b.txt
it('j/k gezer, enter repoyu kapatır ve kapalı kalır'); // enter sonrası a.txt görünmez; bir sonraki yoklamadan sonra da görünmez
it('enter dosyayı mutlak yolla açar', async () => expect(openFile).toHaveBeenCalledWith(join(dirty, 'a.txt')));
it('silinmiş dosyada enter açmaz, "dosya silinmiş" der');
it('yeni dosya yoklamayla listeye girer');     // render'dan sonra c.txt yaz → frame'de c.txt
it('imleç araya satır girince aynı dosyada kalır'); // imleç b.txt'de; a0.txt eklenir → '›' içeren satır b.txt
it('r yeni repoyu bulur');                     // render'dan sonra initRepo → r → adı görünür
it('silinen repo satırı hata gösterir, diğeri yenilenmeye devam eder'); // rm -rf repoA → satırında '!'; repoB'ye dosya ekle → görünür
it('10 satırlık terminalde 30 satırlık liste taşmaz, imleç görünür kalır'); // 20 kez j → '›' frame'de; satır sayısı ≤ 10
// tests/useRepos.test.tsx — küçük bir test bileşeniyle
it('meşgul repoda ikinci runAction çalıştırılmaz', async () => { expect(second).toEqual({ ok: false, error: 'a: başka bir işlem sürüyor' }); expect(fn2).not.toHaveBeenCalled(); });
// tests/zed.test.ts
it('zedCandidates', () => {
  expect(zedCandidates('/f', false)).toEqual([{ cmd: '/Applications/Zed.app/Contents/MacOS/cli', args: ['/f'] }, { cmd: 'open', args: ['-a', 'Zed', '/f'] }]);
  expect(zedCandidates('/f', true)[0]).toEqual({ cmd: 'zed', args: ['/f'] });
});
```

- [ ] **Step 2: Başarısız olduğunu gör.** Run: `npm test` → yeni testler FAIL.
- [ ] **Step 3: `src/zed.ts` ve `src/ui/useRepos.ts`'i yaz.**
- [ ] **Step 4: `src/ui/RepoList.tsx` ve `src/ui/App.tsx`'i yaz.**
- [ ] **Step 5: `src/cli.tsx`'i yaz.**
- [ ] **Step 6: Testler geçsin.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 7: Commit.** `feat: add live repository list with navigation and open in Zed`

---

### Task 6: Stage, commit ve sync tuşları

**Files:**
- Create: `src/ui/TextPrompt.tsx`
- Modify: `src/ui/App.tsx`
- Test: `tests/app-actions.test.tsx`

**Interfaces:**
- Consumes: Task 3 işlemleri; `runAction`, `Mode`, `App` (Task 5).
- Produces:

```ts
export function TextPrompt(props: { label: string; onSubmit(value: string): void; onCancel(): void }): React.JSX.Element;
// Mode genişler:
// | { kind: 'confirmAddAll'; repo: Repo } | { kind: 'commit'; repo: Repo; addAll: boolean }
```

Sabitler:
- `TextPrompt` bildirim satırının yerinde çizilir; tek satır. Gelen yazdırılabilir metin eklenir (yapıştırma çok karakter gelir; satır sonları atılır), backspace son kod noktasını siler, `enter` gönderir, `esc` vazgeçer.
- `space`: dosyada `conflicted` ise bildirim `'çakışmalı dosya; edi'de çözülemez'`; `hasUnstaged` ise `stageFile`, değilse `unstageFile`. Repoda: değişiklik yoksa hiçbir şey; her dosya tam stage'liyse `unstageAll`, değilse `stageAll`.
- `c`: değişiklik yoksa bildirim `'commit edilecek bir şey yok'`; stage'li varsa `commit` modu (`addAll: false`, etiket `commit mesajı: `); yoksa `confirmAddAll` modu, metin birebir `Stage'li dosya yok. Tüm değişiklikler (yeni dosyalar dahil) commit edilsin mi? (e/h)` — `e` → `commit` modu (`addAll: true`), `h`/`esc` → liste.
- `p` / `l` / `f`: imlecin reposunda `push` / `pull` / `fetchRepo`. `F`: tüm repolarda paralel `fetchRepo`; bitince bildirim `'fetch tamam (N repo)'` ya da ilk hata.
- Hepsi `runAction` ile; meşgul etiketleri `'commit ediliyor…'`, `'push ediliyor…'`, `'pull ediliyor…'`, `'fetch ediliyor…'`, stage/unstage için `'…'`.

- [ ] **Step 1: Başarısız testleri yaz:**

```tsx
it('space yeni dosyayı stage eder, tekrar basınca geri alır');   // '[staged]' görünür / kaybolur
it('repo satırında space hepsini stage eder, tekrar basınca hepsini geri alır');
it('çakışmalı dosyada space bildirim verir');                    // "çakışmalı dosya; edi'de çözülemez"
it('c stage'lileri commit eder', async () => { /* 'feat: x' + enter */ expect(await git(repo, 'log', '-1', '--format=%s')).toBe('feat: x\n'); /* diğer dosya hâlâ listede */ });
it('stage'li yokken c onay sorar; h vazgeçer');                  // frame onay metnini içerir; rev-list --count değişmez
it('onayda e sonrası mesajla tüm değişiklikler commit edilir');  // '✓ temiz'
it('temiz repoda c "commit edilecek bir şey yok" der');
it('esc commit girişini kapatır ve liste tuşları yeniden çalışır');
it('Türkçe karakterli mesaj aynen commit edilir');               // 'fix: çökme düzeltildi'
it('yapıştırılan çok satırlı metin tek satıra iner');            // stdin.write('feat: a\nb') → konu 'feat: ab'
it('p upstream'siz branch'i origin'e gönderir');                 // bare'de rev-parse main === yerel HEAD; 'upstream yok' kaybolur
it('ayrışmış geçmişte l hatayı gösterir, HEAD değişmez');
it('F tüm repoları fetch eder');                                 // 'fetch tamam (2 repo)'; geride kalan repoda '↓1'
it('index.lock varken space hatayı gösterir, liste yenilenmeye devam eder'); // bildirimde 'index.lock'; kilit silinip dosya eklenince görünür
```

- [ ] **Step 2: Başarısız olduğunu gör.** Run: `npx vitest run tests/app-actions.test.tsx` → FAIL.
- [ ] **Step 3: `TextPrompt`'u yaz.**
- [ ] **Step 4: `App.tsx`'e modları ve tuşları ekle.**
- [ ] **Step 5: Testler geçsin.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 6: Commit.** `feat: add stage, commit and sync key bindings`

---

### Task 7: Branch seçici

**Files:**
- Create: `src/ui/BranchPicker.tsx`
- Modify: `src/ui/App.tsx`
- Test: `tests/app-branch.test.tsx`

**Interfaces:**
- Consumes: `listBranches`, `switchBranch`, `createBranch` (Task 3); `runAction`, `Mode` (Task 5); `TextPrompt` (Task 6).
- Produces:

```ts
export function BranchPicker(props: { repoName: string; branches: string[]; current: string | null; height: number;
  onSwitch(name: string): void; onNew(): void; onCancel(): void }): React.JSX.Element;
// Mode genişler:
// | { kind: 'branch'; repo: Repo; branches: string[]; current: string | null } | { kind: 'newBranch'; repo: Repo }
```

Sabitler: `b` → `listBranches`; hata ise bildirim, değilse `branch` modu. Seçici listenin yerinde çizilir: başlık `<repoName> · branch`, satırlar; geçerli branch `*` ile işaretli ve imleç onunla başlar; `height`'ı aşarsa `windowTop` ile kayar. `↑↓`/`j`/`k`, `enter` → `onSwitch` (geçerli branch seçilirse yalnız kapanır), `n` → `newBranch` modu (`TextPrompt`, etiket `yeni branch: `; boş ad yok sayılır), `esc` → liste. İşlemler `runAction` ile, etiket `'branch değiştiriliyor…'`.

- [ ] **Step 1: Başarısız testleri yaz:**

```tsx
it('b branch'leri gösterir, geçerli olan işaretli');   // frame '* main' ve 'feat/x' içerir
it('seçip enter'a basınca branch değişir');            // repo satırında 'feat/x'
it('n ile yeni branch açılır ve ona geçilir');         // 'fix/y' yaz + enter → repo satırında 'fix/y'
it('esc değişiklik yapmadan kapatır');
it('boş yeni branch adı hiçbir şey yapmaz');
it('çakışan değişiklik varken geçiş reddedilir, hata görünür, branch aynı kalır');
```

- [ ] **Step 2: Başarısız olduğunu gör.** Run: `npx vitest run tests/app-branch.test.tsx` → FAIL.
- [ ] **Step 3: `BranchPicker`'ı yaz ve `App.tsx`'e bağla.**
- [ ] **Step 4: Testler geçsin.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit.** `feat: add branch picker`

---

### Task 8: Diff görünümü

**Files:**
- Create: `src/ui/DiffView.tsx`
- Modify: `src/ui/App.tsx`
- Test: `tests/app-diff.test.tsx`

**Interfaces:**
- Consumes: `diffFile`, `diffRepo` (Task 3); `Mode` (Task 5).
- Produces:

```ts
export function diffLineColor(line: string): 'green' | 'red' | 'cyan' | undefined;
export function DiffView(props: { title: string; text: string; height: number; onClose(): void }): React.JSX.Element;
// Mode genişler: | { kind: 'diff'; title: string; text: string }
```

Sabitler: `d` dosyada `diffFile`, repoda `diffRepo`; hata ise bildirim, değilse `diff` modu (başlık: dosya yolu ya da repo adı). Görünüm tüm ekranı kaplar: başlık satırı + `height` satır içerik + alt satır `↑↓ kaydır · space/b sayfa · g/G baş/son · esc kapat`. Yalnız görünen dilim çizilir; uzun satırlar kırpılır. `diffLineColor`: `+++`/`---` ile başlayan → `undefined`; `+` → `'green'`; `-` → `'red'`; `@@` → `'cyan'`. Boş diff'te içerik `değişiklik yok`. Tuşlar: `↑↓`/`j`/`k` bir satır, `space`/PageDown ve `b`/PageUp bir sayfa, `g`/`G` baş/son, `esc`/`q` kapatır (uygulamadan çıkmaz).

- [ ] **Step 1: Başarısız testleri yaz:**

```tsx
it('diffLineColor', () => expect(['+++ b/x', '--- a/x', '+a', '-b', '@@ -1 +1 @@', ' c'].map(diffLineColor)).toEqual([undefined, undefined, 'green', 'red', 'cyan', undefined]));
it('d değişen dosyanın diff'ini gösterir');          // '+yeni satır'
it('d yeni dosyanın içeriğini ekleme olarak gösterir');
it('repo satırında d tüm dosyaları gösterir');       // G'ye kadar gezince hem a.txt hem unt.txt başlıkları görülmüş olur
it('esc listeye döner');
it('diff içinde q uygulamadan çıkmaz, listeye döner');
it('5000 satırlık diff 10 satırlık terminalde taşmaz; G son satırı gösterir'); // frame satır sayısı ≤ 10; G → '+satır 5000'
```

- [ ] **Step 2: Başarısız olduğunu gör.** Run: `npx vitest run tests/app-diff.test.tsx` → FAIL.
- [ ] **Step 3: `DiffView`'ı yaz ve `App.tsx`'e bağla.**
- [ ] **Step 4: Testler geçsin.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 5: Commit.** `feat: add scrollable diff view`

---

### Task 9: Claude Code göstergesi

**Files:**
- Create: `src/sessions.ts`
- Modify: `src/ui/App.tsx`, `src/ui/RepoList.tsx`
- Test: `tests/sessions.test.ts`, `tests/app-sessions.test.tsx`

**Interfaces:**
- Consumes: `Repo` (Task 1); `App`, `AppProps` (Task 5).
- Produces:

```ts
export function parseLsofCwd(out: string): string[];      // `lsof -Fpn` çıktısındaki 'n' satırlarının yolları
export function listClaudeCwds(): Promise<string[]>;      // her hata durumunda []
export function assignSessions(cwds: string[], dir: string, repos: Repo[]): { root: number; byRepo: Record<string, number> };
// AppProps genişler: listSessions?: () => Promise<string[]>; sessionPollMs?: number
```

Sabitler: `listClaudeCwds`: `pgrep -x claude` → pid'ler virgülle → `lsof -a -d cwd -p <pid'ler> -Fpn`; süreç yoksa ya da komut başarısızsa `[]`. `assignSessions`: cwd bir `repo.path`'e eşit ya da onun altındaysa (yol **bölütü** sınırıyla: `…/quizei-app-next-quiz`, `…/quizei-app`'e sayılmaz) `byRepo[repo.path]++`; değilse `dir`'e eşit ya da altındaysa `root++`; değilse yok sayılır. `listSessions` varsayılan `listClaudeCwds`, `sessionPollMs` varsayılan 5000; `listSessions` reject ederse sayılar sıfırlanır, bildirim gösterilmez. Çizim: işaret `✻`, renk `#D97757`; repo satırında addan önce `✻` (sayı > 1 ise `✻2`); başlıkta klasörden sonra `✻ N` (yalnız `root > 0` iken).

- [ ] **Step 1: Başarısız testleri yaz:**

```ts
it('parseLsofCwd', () => expect(parseLsofCwd('p50792\nfcwd\nn/a/quizei\np53467\nfcwd\nn/a/quizei/quizei-app\n')).toEqual(['/a/quizei', '/a/quizei/quizei-app']));
it('assignSessions', () => expect(assignSessions(
  ['/a/quizei', '/a/quizei', '/a/quizei/quizei-app/src', '/a/quizei/quizei-app-next-quiz', '/a/quizei/temp', '/baska/yer'],
  '/a/quizei', [{ name: 'quizei-app', path: '/a/quizei/quizei-app' }, { name: 'quizei-app-next-quiz', path: '/a/quizei/quizei-app-next-quiz' }],
)).toEqual({ root: 3, byRepo: { '/a/quizei/quizei-app': 1, '/a/quizei/quizei-app-next-quiz': 1 } }));
it('listClaudeCwds hata fırlatmaz', async () => expect(Array.isArray(await listClaudeCwds())).toBe(true));
// App, listSessions enjekte edilerek
it('başlıkta ve repo satırında ✻ gösterir');   // [dir, dir, repoA] → başlık satırı '✻ 2'; repoA satırı '✻'; repoB satırında '✻' yok
it('aynı repoda iki oturum ✻2 gösterir');
it('listSessions reject ederse işaret yok, uygulama çalışır');
```

- [ ] **Step 2: Başarısız olduğunu gör.** Run: `npx vitest run tests/sessions.test.ts tests/app-sessions.test.tsx` → FAIL.
- [ ] **Step 3: `src/sessions.ts`'i yaz.**
- [ ] **Step 4: `App.tsx` ve `RepoList.tsx`'e yoklamayı ve çizimi ekle.**
- [ ] **Step 5: Testler geçsin.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 6: Commit.** `feat: show Claude Code session indicator`

---

### Task 10: Derleme, kurulum ve gerçek klasörde deneme

**Files:**
- Create: `README.md`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `src/cli.tsx` (Task 5), `npm run build` (Task 1).

- [ ] **Step 1: Başarısız testi yaz** (derlenmiş `dist/cli.js`'i `node` ile çalıştırır; `beforeAll`'da `npm run build`):

```ts
it('klasör olmayan argümanda 1 ile çıkar', async () => { expect(code).toBe(1); expect(stderr).toContain('bir klasör değil'); });
it('repo olmayan klasörde 1 ile çıkar', async () => { expect(code).toBe(1); expect(stderr).toContain('altında git reposu yok'); });
```

- [ ] **Step 2: Başarısız olduğunu gör, derlemeyi düzelt.** Run: `npx vitest run tests/cli.test.ts`. Derlenmiş ESM'de göreli import'ların `.js` uzantısı ve `dist/cli.js`'in shebang'i + çalıştırma izni eksikse tamamla (`build` script'i `tsc && chmod +x dist/cli.js`).
- [ ] **Step 3: Testler geçsin.** Run: `npm test && npm run typecheck` → PASS.
- [ ] **Step 4: `README.md` yaz.** Kurulum (`npm install && npm run build && npm link`), kullanım (`edi [klasör]`), tuş tablosu, ilk sürümde olmayanlar.
- [ ] **Step 5: Kur.** Run: `npm run build && npm link && command -v edi` → bir yol basar.
- [ ] **Step 6: Gerçek klasörde yalnız gözlem.** Run: `edi ~/studios/quizei`. Sekiz repo listelenmeli; başlıkta açık Claude Code oturumları `✻` ile görünmeli; `j`/`k`, `enter` (aç/kapat) ve `d` denenir, `q` ile çıkılır. **Bu adımda `space`, `c`, `p`, `l`, `f`, `F`, `b` tuşlarına basılmaz**; gerçek repolarda değişiklik yapan ilk denemeyi kullanıcı kendisi yapar.
- [ ] **Step 7: Commit.** `docs: add README and verify built CLI`
