# edi — çoklu repo git TUI'si: tasarım

Tarih: 2026-11-24

## Amaç ve neden

Kullanıcı Zed'de çalışıyor: solda terminaller (biri Claude Code), ortada dosya/diff,
sağda dosya gezgini ve git. Bu düzenden memnun. Tek eksik: aynı anda sekiz civarı
repoyla çalışıyor ve Zed'in git paneli bir seferde tek repoyu gösteriyor; diğer
repolarda ne olduğunu görmek için dropdown'dan tek tek seçmek gerekiyor. Antigravity
(VS Code) Source Control görünümündeki gibi **tüm repoların durumunu tek listede
görmek ve oradan commit/sync yapmak** istiyor.

`edi`, Zed'in sol paneldeki terminal sekmelerinden birinde sürekli açık duran bir
terminal uygulamasıdır. Zed'in yerini almaz; sadece bu boşluğu doldurur.

## Hedefler

- Bir klasördeki tüm git repolarının branch, ahead/behind ve değişiklik durumunu
  tek ekranda, canlı göstermek.
- Listeden çıkmadan stage, commit, push, pull, fetch ve branch değiştirme.
- Bir dosyayı tek tuşla Zed'de açmak.
- Hangi klasörde Claude Code oturumu açık olduğunu bir işaretle göstermek.

## Hedef olmayanlar (ilk sürüm)

- Yapay zekâyla commit mesajı üretme.
- Stash, merge, rebase, çakışma çözme, commit geçmişi/graph.
- Satır/hunk bazında stage.
- Discard (değişikliği geri alma). Bilerek yok: yanlış tuşla iş kaybı olmasın.
- Çok satırlı commit gövdesi; ilk sürümde tek satır başlık yazılır.
- Ayar dosyası.

## Karşı hedefler

- Kullanıcının istemediği hiçbir şey remote'a gitmez, hiçbir değişiklik silinmez.
  Yıkıcı ya da geri alınması zor hiçbir git komutu (reset --hard, checkout --,
  clean, force push, rebase) çalıştırılmaz.
- Otomatik fetch/pull/push yok; hepsi tuşla.
- Bir repodaki hata diğer repoların listelenmesini bozmamalı.

## Kısıtlar

- macOS, Node 24 (kurulu), git 2.50. Go/Rust yok.
- Zed CLI PATH'te değil; `/Applications/Zed.app/Contents/MacOS/cli` mevcut.
- Kullanıcının commit kuralı Conventional Commits; edi mesajı doğrulamaz ya da
  değiştirmez, yazılanı aynen commit eder.

## Yaklaşımlar

1. **Hazır CLI (`gita`, `mgitstatus`)** — sıfır geliştirme, ama salt okunur ve
   canlı değil. Kullanıcı commit/sync de istediği için elendi.
2. **Özel TUI (seçilen)** — birkaç günlük iş; istenen listeyi ve işlemleri verir.
   Bedeli: Zed'in sağ dock'unda değil, terminal sekmesinde yaşar (Zed
   extension'ları panel ekleyemiyor).
3. **Zed'e katkı ya da fork** — panel tam yerinde olurdu, ama Rust/GPUI'ye girmek
   ve fork'u güncel tutmak tek özellik için fazla pahalı. Elendi.

Kullanıcı 2'yi seçti.

## Davranış

### Çalıştırma ve repo keşfi

- `edi [klasör]`; klasör verilmezse çalışma dizini.
- Klasörün **bir alt seviyesindeki** `.git` içeren (dizin ya da dosya, yani
  worktree/submodule de) klasörler listelenir, ada göre sıralı.
- Klasörün kendisi bir git reposuysa yalnız o gösterilir.
- Hiç repo yoksa bunu söyleyip çıkar.
- Repo listesi açılışta bir kez taranır; `r` yeniden tarar.

### Ekran

```
 edi · ~/studios/quizei  ✻ 2                         ↻ 5 sn önce
 ▾ quizei-frontend        main            ✓ temiz
 ▾ ✻ quizei-app           main   ↑1       ● 3 değişiklik
     M  src/quiz/Banner.tsx              [staged]
     M  src/quiz/useAds.ts
     ?  src/quiz/banner.test.ts
 ▸ quizei-admin           main            ✓ temiz
 ▸ quizei-backend         feat/x ↓2 ↑1    ● 1 değişiklik
 ────────────────────────────────────────────────────────────────
 space stage · c commit · p push · l pull · f fetch · b branch
 enter Zed'de aç · d diff · r yenile · q çık
```

- Satırlar: repo satırı ve (açıksa) altında dosya satırları. İmleç ↑/↓ ya da j/k
  ile her iki tür satırda gezer.
- Değişikliği olan repolar varsayılan olarak açık, temiz olanlar kapalı gelir.
  Kullanıcı elle açıp kapattıktan sonra o repo için tercihi korunur (oturum boyunca).
- Liste terminal yüksekliğini aşarsa imleçle birlikte kayar.
- Upstream'i olmayan branch'te ahead/behind yerine "upstream yok" gösterilir.
- Detached HEAD'de branch yerine kısa commit hash'i.
- Yeni (untracked) dosyalar klasör olarak değil tek tek listelenir, ki aç ve diff
  her zaman bir dosyaya uygulansın. (Benim kararım.)
- Dosya satırındaki durum harfi: çalışma ağacındaki değişiklik varsa onun harfi,
  yoksa stage'deki; yeni dosya `?`, çakışmalı dosya `U`. Tümü stage'liyse
  `[staged]`, bir kısmı stage'liyse `[kısmen]` etiketi. (Benim kararım.)
- En altta, tuş yardımının üstünde tek satırlık durum/hata alanı: son işlemin
  sonucu ya da git'in hata çıktısının en bilgilendirici satırı (`fatal:` /
  `error:` ile başlayan ya da `[rejected]` içeren ilk satır; yoksa son dolu satır). Devam eden işlem varken repo
  satırında "push ediliyor…" gibi bir gösterge.

### Claude Code göstergesi

Kullanıcı sonradan istedi: bir terminalde Claude Code açıksa bunu görmek.

- İşaret `✻` karakteridir, Claude turuncusuyla (`#D97757`) boyanır. Terminalde
  gerçek logo çizilemez; bu bir Unicode karakteridir.
- Çalışma dizini bir reponun içinde olan Claude Code oturumu varsa o repo
  satırının başında `✻` görünür (birden çoksa `✻2` gibi sayıyla).
- Çalışma dizini taranan klasörün kendisi olan (ya da onun içinde olup hiçbir
  repoya düşmeyen) oturumlar başlık satırında gösterilir:
  `edi · ~/studios/quizei  ✻ 2`. Kullanıcının bugünkü kullanımı bu: Claude Code'u
  repoların üst klasöründe açıyor.
- Yalnız oturumun **açık** olduğu gösterilir; çalışıyor mu bekliyor mu ayrımı yok.
- Tespit: adı tam olarak `claude` olan süreçler ve çalışma dizinleri
  (`pgrep -x claude`, `lsof -a -d cwd -p <pid'ler> -Fpn`). Bu makinede denendi,
  ~20 ms sürüyor. ~5 saniyede bir yoklanır. Tespit başarısız olursa işaret
  gösterilmez, hata da gösterilmez.
- Zed'in kendi terminal sekmesindeki simge edi'den değiştirilemez; kapsam dışı.

### Yenileme

- Her repo ~2 saniyede bir `git status` ile yoklanır; bir repo için önceki yoklama
  bitmeden yenisi başlamaz. Her işlemden sonra ilgili repo hemen yenilenir.
- Dosya sistemi izleme (fs watch) yok; yoklama yeterli. (Benim kararım: node_modules
  gürültüsü ve karmaşıklık yüzünden.)
- Yoklama `git status` çalıştırırken index kilidi almamalı
  (`--no-optional-locks`), ki kullanıcının ya da Claude Code'un o sırada çalıştırdığı
  git komutlarıyla çakışmasın.

### Tuşlar

İmleç repo satırındaysa işlem o repoya, dosya satırındaysa o dosyaya ya da
dosyanın reposuna uygulanır.

| Tuş | Repo satırında | Dosya satırında |
|---|---|---|
| ↑↓ / j k | gez | gez |
| enter | aç/kapat | dosyayı Zed'de aç |
| space | tüm değişiklikleri stage et; hepsi zaten stage'liyse hepsini unstage et | dosyayı stage/unstage et |
| c | commit | dosyanın reposunda commit |
| p | push | reposunda push |
| l | pull | reposunda pull |
| f / F | bu repoda fetch / tüm repolarda fetch | aynı |
| b | branch seçici | reposunda branch seçici |
| d | reponun tüm diff'i | dosyanın diff'i |
| r | repoları yeniden tara ve yenile | aynı |
| q / Ctrl-C | çık | çık |

Dosya satırında `space`: dosyanın stage'siz değişikliği varsa (ya da dosya yeniyse)
stage eder; yalnız stage'li değişikliği kaldıysa unstage eder. Çakışmalı dosyada
bir şey yapmaz, durum satırında "çakışmalı dosya; edi'de çözülemez" der.
(Benim kararım.)

### Commit

- `c` alt satırda tek satırlık mesaj girişi açar; enter commit eder, esc vazgeçer.
  Boş mesajla commit edilmez.
- Stage'li bir şey varsa yalnız stage'liler commit edilir.
- Hiçbir şey stage'li değilse ama değişiklik varsa önce sorar: "Stage'li dosya yok.
  Tüm değişiklikler (yeni dosyalar dahil) commit edilsin mi? (e/h)". Evet ise
  `git add -A` + commit.
- Hiç değişiklik yoksa "commit edilecek bir şey yok" der.
- Hook'lar normal çalışır (`--no-verify` yok). Hook reddederse hata gösterilir.

### Push / pull / fetch

- Push: `git push`. Upstream yoksa `git push -u origin <branch>`; `origin` yoksa
  hata gösterilir. Force push yok.
- Pull: `git pull --ff-only`. Fast-forward mümkün değilse dokunmaz, hatayı gösterir.
- Fetch: `git fetch`, `--prune` olmadan (prune yerel takip referanslarını siler;
  karşı hedeflerle uyumlu kalsın).
- Uzun işlemler arayüzü kilitlemez; aynı repoda aynı anda tek yazma işlemi çalışır.
- Kimlik bilgisi sormaya kalkan git komutu terminali ele geçirmemeli: etkileşimli
  istem kapatılır (`GIT_TERMINAL_PROMPT=0`), başarısız olursa hata gösterilir.
  Kullanıcının credential helper'ı / SSH agent'ı normal çalışır.

### Branch

- `b` reponun yerel branch'lerini listeleyen bir seçici açar (geçerli olan işaretli).
  enter `git switch <branch>` yapar; `n` yeni branch adı sorup `git switch -c` yapar;
  esc kapatır.
- Yalnız remote'ta olan branch'ler ilk sürümde listelenmez.
- Switch, kaydedilmemiş değişiklik yüzünden git tarafından reddedilirse hata
  gösterilir; zorlanmaz.

### Diff

- `d` tam ekran, kaydırılabilir, renkli bir diff görünümü açar (ekleme yeşil,
  silme kırmızı). esc ya da q listeye döner.
- Dosya için: stage'li ve stage'siz değişiklikler birlikte (HEAD'e göre). Yeni
  (untracked) dosya için dosyanın tamamı ekleme olarak. Repo için: tüm
  değişikliklerin diff'i, yeni dosyalar dahil.
- Henüz hiç commit'i olmayan repoda da çalışır (boş ağaca göre diff).
- Zed'in kendi diff görünümünü dışarıdan tetiklemenin güvenilir bir yolu
  doğrulanmadı; ilk sürüm kapsamında değil.

### Zed'de açma

- Sırayla dene: PATH'teki `zed`; yoksa `/Applications/Zed.app/Contents/MacOS/cli`;
  o da yoksa `open -a Zed <dosya>`. Hepsi başarısızsa hata satırında söyle.
- Silinmiş dosyada enter bir şey yapmaz (durum satırında "dosya silinmiş").

## Teknik kararlar (benim kararlarım, kullanıcı onayladı)

- TypeScript + Ink (terminal için React). Node dışında bir şey kurdurmaz.
- Git işlemleri doğrudan `git` CLI ile (kütüphane yok); durum
  `git status --porcelain=v2 --branch -z` ile okunur.
- Kod `~/studios/edi` içinde; `edi` komutu `npm link` ile global.
- Testler: git katmanı geçici dizinlerde gerçek repolarla (remote için yerel bare
  repo), durum çıktısı ayrıştırıcısı birim testle, arayüzün ana akışları
  ink-testing-library ile.

## Yapana bırakılanlar

- Dosya/modül yapısı, state yönetimi, bileşen ayrımı.
- Renkler, sütun hizalama, uzun adların kırpılması.
- Test çerçevesi ve derleme düzeni (tsc/tsx vb.).
- Yoklama aralığının tam değeri ve eşzamanlılık sınırı.
