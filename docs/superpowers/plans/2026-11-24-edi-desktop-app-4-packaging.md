# Paketleme, İkon ve `edi` Komutu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run dist` ile imzasız (ad-hoc) bir `edi.app` üretip `/Applications`'a kurmak, `~/.local/bin/edi` komutuyla klasör açmak, Dock'tan açılınca giriş kabuğunun ortamını kullanmak.

**Architecture:** Paketleme `@electron/packager` ile (`scripts/dist.mjs`); kurulum kararları saf yardımcılarda (`scripts/install.mjs`) ve testli. Komut, uygulamanın `Resources` klasöründeki küçük bir sh betiğidir; `open -n -a` ile ikinci bir kopya başlatır, o kopya tek-kopya kilidine takılıp klasörü ilk kopyaya devreder (`second-instance`). Giriş kabuğu ortamı `src/main/loginEnv.ts` ile açılışta bir kez okunur.

**Tech Stack:** Electron 45, @electron/packager 20.3.0, macOS `codesign`, `sips`, `iconutil`, `ditto`.

**Spec:** `docs/superpowers/specs/2026-11-24-edi-desktop-app-design.md` → "Teknik kararlar / Paketleme", "Sonradan eklenenler" (`edi <path>`, Uygulama ikonu, Giriş kabuğu ortamı).

## Global Constraints

- İmzalama, notarization, otomatik güncelleme yok; ad-hoc imza (`codesign -s -`) yalnız arm64'te açılabilsin diye.
- Uygulama ağa çıkmaz. Kullanıcının `~/.claude/settings.json`'ına dokunulmaz.
- Kurulum: `/Applications/edi.app` ve `~/.local/bin/edi`; edi açıkken kurulmaz; edi'ye ait olmayan `edi.app` ya da `~/.local/bin/edi` üzerine yazılmaz.
- `edi <path>`: klasör değilse hata; uygulama açıksa aynı pencere o klasöre geçer (çalışan terminal varsa "Switch folders?" sorusu); yol yoksa son klasör.
- Testler `/Applications`'a ve `~/.local/bin`'e dokunmaz; kurulum hedefleri parametredir.
- UI metni İngilizce, kod yorumları ve test adları Türkçe.

## Review Focus

1. Giriş kabuğu yavaş, hata veren ya da çıktıya gürültü basan `.zshrc` (nvm, oh-my-zsh, `echo`): açılış takılmamalı, ortam bozulmamalı.
2. `edi` bir dosyaya, var olmayan yola, boşluklu/Türkçe karakterli ya da `-` ile başlayan klasöre: doğru klasör ya da açık hata.
3. edi açıkken `edi ../x`: yeni pencere değil, aynı pencere ve sorusu; pencere küçültülmüşse öne gelir.
4. Paketli uygulamada node-pty (asar dışı `spawn-helper`), Shiki dil dosyaları ve yazı tipleri çalışır.
5. `npm run dist`'i ikinci kez çalıştırmak (güncelleme) ve `/Applications/edi.app` açıkken çalıştırmak.

---

### Task 1: Giriş kabuğu ortamı

**Files:** Create `src/main/loginEnv.ts`; Modify `src/main/main.ts`; Test `tests/loginEnv.test.ts`

**Interfaces:**
- `parseEnvBlock(out: string, marker: string): Record<string, string> | null` — iki marker arasındaki `env -0` çıktısı; marker yoksa null.
- `readLoginEnv(shell: string, opts?: { timeoutMs?: number }): Promise<Record<string, string> | null>` — `shell -ilc 'printf %s M; env -0; printf %s M'`, stdin kapalı, varsayılan 10 s; hata/zaman aşımı null.
- `mergeLoginEnv(base: NodeJS.ProcessEnv, login: Record<string,string>): NodeJS.ProcessEnv` — login değerleri eklenir/üstüne yazar; `PWD`, `OLDPWD`, `SHLVL`, `_` ve `ELECTRON_*`, `EDI_*` alınmaz.

- [ ] Testler: gürültülü çıktı (marker öncesi/sonrası metin, değerde `=` ve satır sonu); marker yoksa null; sahte "kabuk" betiği (geçici dizinde, bayrakları yok sayıp aynı biçimi basan) ile `readLoginEnv`; 1 sn uyuyan sahte kabukla `timeoutMs: 200` → null ve 1 sn'den kısa sürer; `mergeLoginEnv` dışlananlar.
- [ ] FAIL gör, yaz, PASS.
- [ ] `main.ts`: `app.isPackaged` ise `whenReady` içinde `AppCore.create`'ten önce `process.env`'e uygula. Kabuk: `process.env.SHELL || os.userInfo().shell || '/bin/zsh'`.
- [ ] `npm test`, typecheck. Commit `feat(main): take the login shell's environment when packaged`.

### Task 2: Klasör argümanı, tek kopya ve `edi` betiği

**Files:** Create `src/main/args.ts`, `resources/edi` (sh betiği, çalıştırılabilir); Modify `src/main/main.ts`, `src/main/ipc.ts` (gerekirse `focus` için); Test `tests/args.test.ts`, `tests/launcher.test.ts`

**Interfaces:**
- `folderArg(argv: string[]): string | undefined` — `--open` bayrağından sonraki mutlak yol; yoksa ya da göreliyse undefined.
- Betik `resources/edi`: `EDI_APP` (varsayılan `/Applications/edi.app`). Argümansız: `open -a "$EDI_APP"`. Argümanla: `cd -- "$1"` ve `pwd -P` ile mutlak yol; klasör değilse stderr `edi: not a folder: <arg>`, çıkış 1; sonra `open -n -a "$EDI_APP" --args --open "<yol>"`. Birden çok argüman: `usage: edi [folder]`, çıkış 2.
- `main.ts`: `app.requestSingleInstanceLock()`; alınamazsa `app.quit()`. `second-instance` → `folderArg(argv)` varsa `core.openFolder(dir)`; pencereyi göster/öne getir. İlk açılış: `folderArg(process.argv) ?? process.env.EDI_OPEN_DIR`.
- Paketsiz çalışırken (`!app.isPackaged` ve `EDI_USER_DATA` yoksa) userData `edi-dev` olur: geliştirme kopyası kurulu uygulamanın kilidine takılmasın.

- [ ] Testler: `folderArg` (`--open /a b/ç`, göreli yol, bayrak yok, bayrak sonda); betik: PATH'in başına sahte `open` (argümanlarını dosyaya yazar) koyup `sh resources/edi`, `edi .`, `edi "boş luk"`, `edi -- -tire` değil `edi ./-tire`, dosya → hata 1, var olmayan → hata 1, iki argüman → 2, argümansız → `-a`.
- [ ] FAIL gör, yaz, PASS. `npm test`, typecheck, `npm run e2e` (tek kopya kilidi e2e'yi bozmamalı). Commit `feat(main): open a folder passed by the edi command`.

### Task 3: İkon

**Files:** Create `scripts/make-icon.mjs`, `build/icon.icns`; Modify `package.json` (`"icon": "electron scripts/make-icon.mjs"`)

- [ ] `scripts/make-icon.mjs` Electron ile çalışır: `docs/design/icon/wordmark.svg`'yi, `@fontsource/ibm-plex-mono` 600 ağırlığı `@font-face` ile gömülü, şeffaf, gizli bir pencerede 1024×1024 çizer, `capturePage` → PNG; `sips -z` ile iconset boyutları (16…1024, @2x), `iconutil -c icns` → `build/icon.icns`. Geçici dosyalar `os.tmpdir()`'de.
- [ ] Çalıştır; `sips -g pixelWidth` ve `iconutil -c iconset` ile geri açıp 1024 PNG'ye bak (yazı IBM Plex Mono mu). Commit `build: generate the app icon from the wordmark`.

### Task 4: Paketleme ve kurulum

**Files:** Create `scripts/dist.mjs`, `scripts/install.mjs`; Modify `package.json` (`dist`, `@electron/packager` 20.3.0 dev, `react`/`shiki` devDependencies'e), `playwright.config.ts` (paketli uygulama için ayrı proje), `README.md`; Test `tests/install.test.ts`, `e2e-dist/packaged.spec.ts`

**Interfaces (`scripts/install.mjs`):**
- `BUNDLE_ID = 'dev.edi.app'`
- `checkTarget(appPath: string): Promise<'missing' | 'ours' | 'foreign'>` — `Contents/Info.plist`'teki `CFBundleIdentifier` (`plutil -extract … raw`).
- `checkLink(linkPath: string, target: string): Promise<'missing' | 'ours' | 'foreign'>` — bizim bağımız: `target`'a giden symlink.
- `isRunning(appPath: string): Promise<boolean>` — `pgrep -f <appPath>/Contents/MacOS/`.
- `install({ built, appPath, linkPath }): Promise<string[]>` — sırayla: çalışıyorsa hata "Quit edi before installing"; foreign ise hata; eski `ours` kopyayı silip `ditto built appPath`; bağ yoksa kur, `ours` ise dokunma, foreign ise hata. Dönen: yapılanların satırları.

**`scripts/dist.mjs`:** `npm run build` → packager (`name: 'edi'`, `appBundleId: BUNDLE_ID`, `icon: build/icon.icns`, `out: release`, `asar: { unpack: '**/node_modules/node-pty/**' }`, `extraResource: ['resources/edi']`, `ignore`: yalnız `/dist`, `/package.json`, `/node_modules` kalır, `overwrite: true`) → `codesign --force --deep -s -` → `--no-install` yoksa `install`. Çıktı satırları İngilizce.

- [ ] Testler (`tests/install.test.ts`, geçici dizinde sahte `.app`'ler): missing/ours/foreign; foreign app ve foreign bağ hata verir, hiçbir şey silinmez; ours güncellenir (eski dosya gider, yeni gelir); bağ kurulur ve ikinci çalıştırmada değişmez; çalışan kopya varken hata (sahte `isRunning`).
- [ ] FAIL gör, yaz, PASS.
- [ ] `npm run dist -- --no-install`; `e2e-dist/packaged.spec.ts` (`_electron.launch({ executablePath: release/…/edi.app/Contents/MacOS/edi })`, `EDI_USER_DATA` geçici, `--open <geçici repo>`): repo görünür, terminalde `echo` çalışır (node-pty), bir dosya açılınca renklenir (Shiki). `npm run e2e:dist` betiği.
- [ ] README: Kurulum bölümü (`npm run dist`, ne kurar, `edi .`). `npm test`, typecheck, `npm run e2e`, `npm run e2e:dist`. Commit `build: package and install edi with npm run dist`.
- [ ] Kullanıcının makinesinde kurulumu (gerçek `/Applications` ve `~/.local/bin`) **kullanıcı** başlatır ya da açıkça ister; executor çalıştırmaz.
