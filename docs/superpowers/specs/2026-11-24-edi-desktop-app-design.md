# edi — masaüstü uygulaması: tasarım

Tarih: 2026-11-24

Bu belge, `2026-11-24-edi-multi-repo-git-tui-design.md` belgesinin **arayüz**
kısmının yerini alır. O belgedeki git davranışı ve karşı hedefler geçerlidir;
burada uygulamaya uyarlanmış halleriyle yeniden yazılmıştır. İkisi çelişirse bu
belge geçerlidir.

Görsel tasarımın kaynağı: `docs/design/edi-ui/` (tuvalin dosyaları) ve aynı
tuvalin canlı hali <https://claude.ai/artifact/H9e4gijgVcFaK4s9mKkKbH>. Ölçüler,
renkler ve metinler için o dosyalar esas alınır; bu belge davranışı anlatır.

## Amaç ve neden

Kullanıcı sekiz civarı repoyla aynı anda çalışıyor ve işinin çoğunu terminalde,
Claude Code ile yapıyor. Zed'in düzenini (solda terminaller, ortada dosya/diff,
sağda dosyalar ve git) seviyor ama Zed'in git paneli bir seferde tek repo
gösteriyor. İstediği şey bir IDE değil; kendi deyişiyle "git destekli terminal
yönetim aracı": terminaller ve Claude Code oturumları solda, **tüm repoların**
durumu ve geçmişi sağda, bakmak istediği dosya ya da diff ortada.

Önce bunu Zed'in terminal sekmesinde yaşayan bir TUI olarak planladık. Git
çekirdeği o plan için yazıldı (`src/git/*`, 100 test). Sonra bir günlük Electron
denemesi yaptık (`spike/electron-terminal`); kullanıcı kendi zsh profiliyle,
Türkçe klavyeyle, Shift+Enter ve yapıştırmayla sorunsuz çalıştığını doğruladı ve
kendi uygulamamızı yazmaya karar verdi.

## Hedefler

- Bir klasördeki tüm git repolarının branch, ahead/behind ve değişiklik durumunu
  tek listede, canlı görmek; o listeden stage, commit, push, pull, fetch ve
  branch değiştirme yapmak.
- Aynı pencerede birden çok terminal sekmesi; Claude Code çalışan sekmeyi
  simgesinden tanımak ve yanıt bekleyeni ayırt etmek.
- Tüm repoların son commit'lerini tek zaman çizelgesinde görmek; bir commit'e
  tıklayıp içeriğine bakmak.
- Bir dosyaya ya da değişikliğe bakmak (salt okunur) ve tek tıkla Zed'de açmak.

## Hedef olmayanlar (ilk sürüm)

- Orta panelde düzenleme. Dosyalar salt okunur; düzenleme için "Open in Zed".
- Arama (dosya adı ya da içerik).
- Uygulama kapanınca terminal oturumlarını saklayıp geri getirmek.
- Yapay zekâyla commit mesajı üretme.
- Stash, merge, rebase, çakışma çözme, cherry-pick, commit graph'ı.
- Satır/hunk bazında stage. Discard (değişikliği geri alma).
- Ayar ekranı ve ayar dosyası; vurgu rengi, yazı tipi, kısayollar sabittir.
  (Tasarımdaki dişli düğmesi ilk sürümde yok.)
- Birden çok pencere, birden çok çalışma klasörü.
- İmzalama, notarization, otomatik güncelleme, başkasına dağıtım.
- Yalnız remote'ta olan branch'ler; HEAD dışındaki branch'lerin geçmişi.
- Görsel önizleme. İkili dosyalar "binary file" notuyla gösterilir.

## Karşı hedefler

- Kullanıcının istemediği hiçbir şey remote'a gitmez, hiçbir değişiklik
  silinmez. Şu git komutları kodda hiçbir yolla çalıştırılmaz: `reset --hard`,
  `checkout -- <yol>`, `restore` (çalışma ağacına), `clean`, force push,
  `rebase`, `--no-verify`, `fetch --prune`.
- Otomatik fetch/pull/push yok; hepsi kullanıcının tıklamasıyla.
- Uygulama terminallere kendi başına komut yazmaz. Tek istisna: "yeni Claude
  oturumu" düğmesi, yeni açtığı sekmeye `claude` yazar.
- Bir repodaki hata diğer repoları bozmaz.
- Ağ isteği yok: yazı tipleri uygulamaya gömülür, telemetri yok.
- edi çakışmayı çözülmüş işaretlemez.

## Kısıtlar

- macOS (Apple silicon), Node 24, git 2.50. Go/Rust kurulu değil.
- npm 12 kurulum betiklerini engelliyor: node-pty'nin hazır ikilisi kullanılır
  ve `spawn-helper` çalıştırılabilir yapılır; Electron ikilisi ayrıca indirilir.
- Zed CLI PATH'te olmayabilir; `/Applications/Zed.app/Contents/MacOS/cli` var.
- Kullanıcının commit kuralı Conventional Commits; edi mesajı doğrulamaz ya da
  değiştirmez.
- Arayüz dili İngilizce.

## Yaklaşımlar

1. **Zed'in terminal sekmesinde TUI** — en ucuzu; çekirdeği yazıldı. Ama dosya
   ve diff görünümü terminalde zayıf, Claude sekmesini işaretleyemiyor ve Zed'in
   sağ panelinde yaşayamıyor (Zed eklentileri panel ekleyemiyor).
2. **Kendi masaüstü uygulaması, Electron (seçilen)** — üç panelin tamamı bizim.
   Bedeli: terminal kalitesi ve paketleme bizim sorumluluğumuz. Terminal riski
   denemeyle kapandı.
3. **Tauri** — daha hafif, ama Rust kurulu değil ve pty tarafı sıfırdan
   denenmeli. Elendi.
4. **Zed fork'u** — panel tam yerinde olurdu; Rust/GPUI ve fork bakımı tek
   kişilik bir araç için fazla pahalı. Elendi.

Kullanıcı denemeden sonra 2'yi seçti.

## Pencere

Tek pencere. Üstte başlık çubuğu, altında durum çubuğu, arada üç panel: sol
(terminaller), orta (dosya/diff/commit), sağ (Git, History, Files).

- **Başlık çubuğu:** macOS trafik ışıkları, "edi", ortada klasör düğmesi
  (`~/studios/quizei`), sağda bu klasör altında açık Claude Code oturumlarının
  sayısı ("2 sessions"; hiç yoksa gizli).
- **Klasör düğmesi:** son klasörler ve "Choose folder…" içeren menü açar.
  Klasör değiştirmek açık terminalleri kapatır; çalışan süreç varsa önce sorar.
- **Açılış:** son açılan klasör hâlâ duruyorsa onunla açılır; yoksa boş durum
  ekranı ("Open a folder", son klasörler listesi).
- **Paneller:** aralarındaki çizgiden sürüklenerek genişletilir; genişlikler
  hatırlanır. Orta panel kapalıyken sol panel boşalan yeri alır.
- **Durum çubuğu:** solda "8 repositories", değişikliği olan repo sayısı,
  push bekleyen repo sayısı; sağda orta panelde açık olan şeye göre kısa bilgi.
- **Çıkış:** çalışan süreci olan terminal varsa çıkmadan önce sorar.

Repo keşfi TUI belgesindeki gibidir: açılan klasörün bir alt seviyesindeki
`.git` içeren klasörler, ada göre; klasörün kendisi repoysa yalnız o. Hiç repo
yoksa terminaller yine çalışır, sağ panel "No git repositories in this folder"
der.

### Hangi Claude Code oturumları sayılır

Başlık çubuğundaki sayı ve repo satırındaki Claude işareti, bu makinede **bir
terminalde** çalışan (tty'si olan) ve çalışma dizini açık klasörün içinde olan
Claude Code oturumlarını gösterir; edi'nin kendi sekmelerindekiler de, başka bir
terminal uygulamasındakiler de sayılır. Terminali olmayan oturumlar (ör. Zed'in
agent panelinin arka planda çalıştırdığı) sayılmaz. Çalışma dizini bir reponun
içindeyse o reponun satırında işaret görünür. (Benim kararım: başka bir yerde
aynı repoda çalışan bir Claude'u bilmek işe yarar; görünmeyen arka plan
süreçlerini saymak ise sayıyı anlamsızlaştırır.) `src/sessions.ts` buna göre
tty süzgeci kazanır.

## Sol panel: terminaller

- Her sekme kullanıcının giriş kabuğunu (login + interactive) çalıştıran gerçek
  bir pty'dir; çalışma dizini açık klasördür. Repo satırındaki terminal düğmesi
  sekmeyi o reponun dizininde açar.
- Kabuğa verilen ortamdan `CLAUDECODE`, `CLAUDE_CODE_*` ve `ELECTRON_*`
  değişkenleri çıkarılır.
- Klavye: Option tuşu Meta sayılmaz (Türkçe klavyede `@ # [ ]` yazılabilsin),
  Shift+Enter yeni satır gönderir (`ESC CR`), Cmd+C/Cmd+V kopyala/yapıştır.
- **Sekme çubuğu:** sekmeler, sağda `+` (yeni terminal) ve Claude simgeli düğme
  (yeni Claude oturumu). Sekme adı öndeki sürecin komutudur (`npm run dev`);
  boşta kabuğun adıdır (`zsh`). Adlar alt satıra geçmez; yer daralınca üç
  noktayla kısalır. Aktif sekmede kapatma çarpısı vardır.
- **Claude sekmesi:** bir sekmenin tty'sinde Claude Code öndeyken sekme adı
  `claude`, simgesi turuncu Claude işareti (`#D97757`) olur; Claude kapanınca
  sekme normale döner. Kullanıcı Claude'u düğmeyle de açsa, düz sekmede `claude`
  yazarak da açsa aynı şekilde tanınır. Tespit süreç adına değil tty'ye göre
  yapılır (node-pty süreç adını sürüm numarası olarak veriyor).
- **Yanıt bekleyen Claude:** aşağıda "Yanıt bekleme işareti" bölümü.
- **Süreç bitince:** sekme kapanmaz; adının yanında soluk "exited" yazar,
  kullanıcı kapatır. (Benim kararım: çıktı okunabilsin.)
- **Kısayollar:** Cmd+T yeni terminal, Cmd+Shift+T yeni Claude oturumu, Cmd+W
  aktif sekmeyi kapat (süreç çalışıyorsa sorar), Cmd+1…9 sekmeye geç, Cmd+O
  klasör aç. Cmd+W ve Cmd+R pencereyi kapatmaz/yenilemez.

### Yanıt bekleme işareti

Claude Code yanıt beklerken (izin soruyor ya da sırayı kullanıcıya bırakmış)
sekmesinde sarı bir zil simgesi görünür; kullanıcı o sekmeye geçince ya da
Claude yeniden çalışmaya başlayınca kaybolur.

Mekanizma (benim kararım; yarısı doğrulandı):

- Claude Code durumunu çalıştığı terminale kendisi bildiriyor. 2.1.331 ile
  denendi: boşta beklerken terminal başlığını `✳ Claude Code` yapıyor (OSC 0) ve
  açılışta terminale "OSC 7501 Program Status" protokolünü destekleyip
  desteklemediğini soruyor (`OSC 7501 ; ?`). Bu bilgi sekmenin kendi pty
  akışından gelir: ayar değişikliği, hook ya da süreç eşleştirmesi gerekmez ve
  kullanıcı Claude'u nasıl açarsa açsın çalışır.
- **İlk tercih:** sekmenin başlığındaki durum işaretini okumak. Çalışırken ve
  izin sorarken başlığın ne olduğu henüz gözlenmedi; bu kısmın ilk işi bunu
  gerçek bir oturumda kaydetmek ve kuralı gözleme göre yazmaktır.
- **Yedek:** `claude agents --json` (Claude Code'un oturum durumunu dışarıdan
  okumak için belgelediği yol; `status: busy | waiting | idle` ve `pid` verir),
  pid → tty eşleştirmesiyle.
- Kullanıcının `~/.claude/settings.json` dosyasına dokunulmaz, hook enjekte
  edilmez, `claude` komutu sarmalanmaz, `TERM_PROGRAM` başka bir terminal gibi
  gösterilmez.
- İkisi de güvenilir çıkmazsa zil ilk sürümden çıkarılır ve kullanıcıya
  söylenir: yanlış çalan zil, hiç olmayan zilden kötüdür.

## Orta panel

Varsayılan olarak kapalıdır. Sağ panelde bir dosyaya, değişikliğe ya da
commit'e tıklanınca açılır. Sekme çubuğunun sağ ucundaki çarpı paneli kapatır;
sekmeler yerinde kalır ve bir şeye tıklanınca panel aynı sekmelerle geri gelir.
Son sekme kapatılınca panel de kapanır.

- **Sekmeler:** tek tıklama önizleme sekmesi açar (bir sonraki tek tıklama aynı
  sekmeyi değiştirir); çift tıklama sekmeyi kalıcı yapar. Zaten açık olan şeye
  tıklamak o sekmeye geçer. (Benim kararım: diff'ler arasında gezerken sekme
  birikmesin.)
- **Diff görünümü** (Git sekmesinden): dosyanın HEAD'e göre tüm değişikliği
  (stage'li + stage'siz birlikte). Üstte repo ve yol, `+7 −3`, "Split / Inline"
  seçimi (hatırlanır) ve "Open in Zed". Yeni (untracked) dosya diff yerine dosya
  görünümünde "new file" rozetiyle açılır. Henüz commit'i olmayan repoda da
  çalışır.
- **Dosya görünümü** (Files sekmesinden): salt okunur, satır numaralı, sözdizimi
  renkli. Üstte yol, "Read-only" notu ve "Open in Zed". 1 MB'tan büyük ya da
  ikili dosyalar gösterilmez; yerine kısa bir not ve "Open in Zed" çıkar.
- **Commit görünümü** (History sekmesinden): başlık (Conventional Commits öneki
  soluk), gövde metni, repo, branch, göreli zaman, toplam `+/−`, kısa hash ve
  kopyalama düğmesi; altında değişen dosyalar alt alta, her biri satır içi
  diff'iyle. Dosya başlığı diff'i açıp kapatır; 400 satırı aşan diff kapalı
  gelir.
- **Open in Zed:** sırayla PATH'teki `zed`, `/Applications/Zed.app/Contents/MacOS/cli`,
  `open -a Zed`. Hepsi başarısızsa hata gösterilir.
- Dosya diskte değişirse açık görünüm, o reponun bir sonraki durum yoklamasında
  yenilenir.

## Sağ panel

Üç sekme: **Git** (değişen dosya sayısı rozetiyle), **History**, **Files**.

### Git

Tüm repolar alt alta. Değişikliği olan repolar açık, temiz olanlar kapalı gelir;
kullanıcı elle açıp kapattıysa oturum boyunca o tercih geçerlidir.

**Kapalı repo satırı** (soldan sağa): ad (yer daralınca kısalır); içinde Claude
Code oturumu varsa Claude işareti; boşluk; branch; durum (`✓` ya da değişiklik
sayısı); ve gerekiyorsa en sağda tek bir eşitleme düğmesi. Sayı düğmenin
üstünde yazar; ayrıca `↑1` gibi bir yazı gösterilmez. Tasarım dosyalarındaki
tüm satırlar bu biçimdedir.

| Durum | Düğme | Yaptığı |
|---|---|---|
| Geride (`↓n`) | "Pull n" | `git pull --ff-only` |
| Yalnız ileride (`↑n`) | "Push n" | `git push` |
| Upstream yok, commit var | "Publish branch" | `git push -u origin <branch>` |
| Eşit | yok | |

Hem ileride hem gerideyse "Pull n" gösterilir; fast-forward mümkün değilse
git'in hatası gösterilir, edi zorlamaz. Upstream'i olmayan branch'te hiç commit
yoksa düğme gösterilmez. Düğmelerin görünümü: "Push" dolu (vurgu rengi), "Pull"
sarı yazılı çerçeveli, "Publish branch" nötr çerçeveli.

**Açık repo:** başlıkta ad, branch düğmesi, pull, push ve "bu repoda terminal
aç"; altında commit kutusu ve dosya grupları.

- **Dosya grupları:** "Staged" ve "Changes"; her dosyada durum harfi (M, A, D,
  R, `?`; silinen dosyanın adı üstü çizili), ad, klasör ve tek dosyayı
  stage/unstage eden düğme; grup başlığında hepsini stage/unstage eden düğme.
  Bir kısmı stage'li dosya iki grupta da görünür ve "partly staged" etiketi
  taşır. Yeni dosyalar klasör olarak değil tek tek listelenir.
- **Çakışmalar:** ayrı "Conflicts" grubu (`U`), her dosyada "Open in Zed".
  Çakışmalı dosya edi'den stage edilemez; çakışma varken "tümünü stage et" ve
  "Commit all" reddedilir. Repo başlığında "merging" etiketi görünür.
- **Commit kutusu:** çok satırlı metin alanı (ilk satır başlık, gerisi gövde).
  Cmd+Enter commit eder. Mesaj boşken düğme pasiftir.
  - Stage'li dosya varsa düğme "Commit · N files"; yalnız stage'liler commit
    edilir.
  - Hiçbir şey stage'li değilse düğme "Commit all · N files" olur ve altında
    "Nothing is staged. This commits every change, new files included." yazar;
    basılınca `git add -A` + commit. Ayrıca onay sorulmaz. (Benim kararım:
    düğmenin adı ve notu onayın yerini tutuyor.)
  - Düğmenin yanındaki ok tek seçenekli bir menü açar: "Commit and push".
  - Hook'lar normal çalışır; hook reddederse hatası gösterilir.
- **Branch menüsü:** yerel branch'ler, geçerli olan işaretli; seçince
  `git switch`. "New branch…" ad sorar ve `git switch -c` yapar. Git reddederse
  (kaydedilmemiş değişiklik) hata gösterilir, zorlanmaz.
- **Meşgul ve hata:** süren işlemde repo satırında dönen işaret ve "Pushing…"
  gibi bir yazı. Aynı repoda aynı anda tek yazma işlemi çalışır; ikincisi
  istenirse "Another operation is still running" denir. Hata, reponun altında
  kırmızı bir kutuda git'in en bilgilendirici satırıyla gösterilir; reddedilen
  push'ta kutuda "Pull" düğmesi olur; "Dismiss" kutuyu kapatır.
- **Sekme başlığındaki düğmeler:** tüm repolarda fetch; repoları yeniden tara.
- Kimlik bilgisi isteyen git komutu arayüzü kilitlemez (`GIT_TERMINAL_PROMPT=0`);
  başarısız olur ve hatası gösterilir. Credential helper ve SSH agent normal
  çalışır.

### History

Tüm repoların geçerli branch'lerindeki (HEAD) commit'leri tek listede, yeniden
eskiye, gün başlıkları altında ("Today", "Yesterday", "This week", daha eskiler
tarihle). Repo başına son 50 commit okunur; listenin sonundaki "Load 50 more"
her repodan 50 tane daha getirir.

Birleşik liste eksik göstermez: daha eski commit'i kalmış repoların yüklenen en
eski commit'lerinden en yenisi sınırdır ve liste o sınırdan eskiyi göstermez
(yoksa hareketli bir reponun eski günleri "o gün commit yokmuş" gibi görünür).
"Load 50 more" sınırı geriye iter. Tüm commit'leri yüklenmiş repolar sınırı
belirlemez. (Benim kararım.)

- **Satır:** başlık (Conventional Commits öneki soluk), altında repo adı, göreli
  zaman ve sağda kısa hash. Yazar, o reponun `user.email` değerinden farklıysa
  adıyla gösterilir; kullanıcının kendi commit'lerinde gösterilmez.
- **Push edilmemiş commit:** upstream'de olmayan commit'in satırında yukarı ok.
- **Sürüm satırı:** etiketli bir commit'in başlığı etiketin kendisiyse (`1.86.0`
  ↔ `v1.86.0`) ince bir etiket satırı olarak gösterilir; değilse normal satırda
  etiket rozeti görünür.
- **Merge commit'leri** soluk gösterilir.
- **Süzme:** "All repositories" menüsünden tek repo seçilir. Tek repoda satırda
  repo adı yazmaz ve push edilmiş/edilmemiş commit'lerin arasına `origin/main`
  çizgisi girer.
- **Düzen seçimi:** "Timeline" (yukarıdaki) ve "By repo": her repo başlığının
  altında son üç commit tek satırlık; hiç yakın commit'i olmayan repolar kapalı
  ve son commit zamanıyla. Seçim hatırlanır.
- Bir commit'e tıklamak orta panelde commit görünümünü açar.
- Liste; o repoda commit, pull ya da fetch yapılınca, HEAD değişince ve yenile
  düğmesiyle güncellenir.

### Files

Açık klasördeki repolar en üst düzeyde klasör olarak; her birinin altında
çalışma ağacı. `.gitignore`'a takılan dosyalar (ör. `node_modules`)
gösterilmez. Değişen dosyalar durum harfi ve rengiyle, değişiklik içeren
klasörler nokta ile işaretlenir. Bir dosyaya tıklamak dosya görünümünü açar.
Sekme başlığındaki düğme tüm klasörleri kapatır. Açık klasörün kendisi tek bir
repoysa ağaç doğrudan o reponun içeriğiyle başlar.

## Yenileme

- Her repo ~2 saniyede bir `git status` ile yoklanır (`--no-optional-locks`);
  bir repo için önceki yoklama bitmeden yenisi başlamaz. Her işlemden sonra
  ilgili repo hemen yenilenir.
- Claude Code oturumları ve sekmelerin öndeki süreçleri ~3 saniyede bir
  yoklanır. Tespit başarısız olursa işaret gösterilmez, hata da gösterilmez.
- Dosya sistemi izleme yok.

## Görsel dil

One Dark tabanlı koyu tema; açık tema yok.

- **Yüzeyler:** terminal/orta panel `#282C34`, paneller ve çubuklar `#21252B`,
  açık repo `#252930`, giriş alanları `#1B1D23`, seçili satır `#2F343E`,
  çizgiler `#181A1F`.
- **Metin:** birincil `#D7DAE0`, ikincil `#ABB2BF`, soluk `#969DA8`.
- **Vurgu:** nötr açık gri `#D7DAE0` (ana düğme, aktif sekme çizgisi, seçili
  satır işareti, push sayacı); üstündeki metin `#1B1D23`.
- **İşaret renkleri:** sarı `#E5C07B` (değişmiş, pull edilecek, zil), yeşil
  `#98C379` (yeni, eklenen satır, temiz), kırmızı `#E06C75` (silinmiş, silinen
  satır, hata, çakışma), camgöbeği `#56B6C2` (yeniden adlandırılmış, hunk
  başlığı), Claude turuncusu `#D97757` (yalnız Claude Code için).
- **Yazı:** arayüz IBM Plex Sans 13 px; yollar, branch'ler, hash'ler, commit
  mesajı ve kod IBM Plex Mono 12 px. İkisi de uygulamaya gömülür. Terminal
  denemedeki yazı tipi yığınını kullanır (`SF Mono`, Menlo, Monaco).
- Simgeler çizgisel SVG'dir; emoji yok.

## Teknik kararlar (benim kararlarım)

- **Electron + React + TypeScript.** Terminal: `@xterm/xterm` (WebGL çizim) ve
  `node-pty`; ikisi de denemede doğrulandı.
- **Süreç ayrımı:** git, pty ve dosya okuma ana süreçte; arayüz, `contextIsolation`
  açık, `nodeIntegration` kapalı bir pencerede. Arayüz ana sürece dar ve tipli
  bir köprüden erişir: bir repo yolu ve bir işlem adı gönderir, hiçbir zaman
  serbest komut göndermez; ana süreç yolun keşfedilmiş repolardan biri olduğunu
  doğrular.
- **Git** yalnız `git` CLI ile, mevcut `src/git/*` üzerinden; git çıktısı
  İngilizceye sabitlenir (`LC_ALL=C`) ki hata satırı seçimi yerel ayara bağlı
  olmasın.
- **Diff ve dosya görünümü** kendi bileşenimiz: unified diff çekirdekte
  ayrıştırılır, renklendirme Shiki ile (One Dark Pro teması). Monaco
  kullanılmaz. (Neden: salt okunur, commit görünümünde çok sayıda diff alt alta
  ve tasarımla birebir.)
- **Kalıcı durum** (son klasör, son klasörler, panel genişlikleri, diff ve
  history düzeni, pencere konumu) Electron'un kullanıcı veri klasöründe tek bir
  JSON dosyasında.
- **Paketleme:** geliştirirken `npm run dev`; `npm run dist` Dock'a
  konabilecek, imzasız bir `edi.app` üretir.
- **Testler:** git çekirdeği geçici dizinlerde gerçek repolarla (bugünkü gibi;
  yeni log, commit içeriği ve dosya listesi işlevleri dahil); diff ayrıştırıcı
  ve history birleştirme birim testle; arayüz bileşenleri bileşen testleriyle;
  ana akışlar (klasör aç, repoları gör, stage, commit, terminalde komut çalıştır,
  diff aç) Playwright'ın Electron desteğiyle, geçici bir çalışma klasöründe.
  Hiçbir test `~/studios` altındaki gerçek repolara dokunmaz.

## Mevcut koddan kalan ve giden

- **Kalır:** `src/git/exec.ts`, `discover.ts`, `status.ts`, `actions.ts`,
  `src/sessions.ts` ve testleri.
- **Değişir:** çekirdekteki Türkçe metinler (hata mesajları, etiketler)
  İngilizce olur. `RepoStatus`'a HEAD'in commit kimliği eklenir.
- **Eklenir:** commit geçmişi, tek commit'in içeriği, izlenen/izlenmeyen dosya
  listesi, dosya okuma, tty'ye göre süreç tespiti.
- **Gider:** Ink TUI bağımlılıkları (`ink`, `ink-testing-library`), `bin`
  girdisi, `src/ui/rows.ts` içindeki TUI'ye özgü kısımlar, `diffRepo`,
  ve uygulamanın terminali çalışınca `spike/electron-terminal`.
- **Bu işle birlikte kapanacak, incelemeden kalan küçük bulgular:** etiketle
  aynı adlı branch'in `heads/…` görünmesi; `-` ile başlayan ref adları ve
  `refs/heads/<branch>` ile push; upstream'i silinmiş branch'te push; silinmiş
  repo klasörünün `spawn git ENOENT` göstermesi; arka plana süreç atan hook'ta
  yanlış zaman aşımı; kopya kayıtlarında `origPath`.
- **Açık kalan:** commit'siz SHA-256 repoda diff tabanı.

## Yapana bırakılanlar

- Dosya/modül yapısı, state yönetimi, bileşen ayrımı, derleme araçları.
- Köprünün (IPC) tam biçimi.
- Yoklama aralıklarının tam değerleri, pencere arka plandayken yavaşlatma.
- Panellerin en küçük genişlikleri, uzun listelerde sanallaştırma.
- Yan yana diff'te silinen ve eklenen satırların eşleştirilmesi.
- Göreli zaman biçimi ve gün gruplarının sınırları.

## Sonradan eklenenler

Tasarım onaylandıktan sonra kullanıcının istediği, henüz planlanmamış şeyler.

- **`edi <path>` komutu (2026-11-24):** herhangi bir terminalde `edi <path>` yazınca
  o klasör edi'de açılır; `edi .` bulunulan klasörü açar. Paketleme planına (plan 4)
  aittir: komut, kurulu uygulamayı başlatan küçük bir betiktir (PATH'e konur),
  uygulama da başlatılırken verilen klasörü açar. Uygulama zaten açıksa aynı pencere
  o klasöre geçer; çalışan terminal varsa klasör değiştirmedeki soru burada da sorulur.
  Yol verilmezse uygulama son klasörle açılır. Komutun PATH'e nasıl konacağı
  (uygulamadan "Install command line tool" mu, elle bağ mı) planlanırken kararlaştırılır.
- **Uygulama ikonu (2026-11-24):** kullanıcı "Wordmark" seçeneğini seçti
  (`docs/design/icon/wordmark.svg`). Plan 4'te `.icns` bundan üretilir.

- **Çalışan sunucular (2026-11-24, kullanıcı onayladı):** edi'nin terminallerinde ayağa
  kalkan geliştirme sunucuları (ör. `npm run dev` ile `localhost:5173`) listelenir, adrese
  tıklanınca varsayılan tarayıcıda açılır. Amaç: terminale dönüp adres aramadan sunucuya
  ulaşmak.
  - **Bulma (kullanıcının seçtiği yol):** terminal çıktısından değil, süreç ağacından.
    3 saniyelik süreç yoklamasında, edi terminallerinin tty'sinde çalışan ve kabuk olmayan
    süreçlerin dinlemeye açtığı TCP portları `lsof -nP -a -iTCP -sTCP:LISTEN -p <pid'ler>`
    ile okunur. Böylece çıktı kaydırılıp gitse de görünür, sunucu kapanınca en geç bir
    yoklamada kaybolur. Hiçbir sekmede kabuk dışında süreç yoksa `lsof` çalıştırılmaz.
  - Yalnız `localhost`'tan erişilebilen dinlemeler sayılır: `*`, `0.0.0.0`, `[::]`,
    `127.x.x.x`, `[::1]`. Yalnız belirli bir ağ adresinde dinleyen alınmaz. Aynı port IPv4
    ve IPv6'da dinlenirse tek sayılır.
  - Sunucunun reposu, dinleyen sürecin çalışma dizininden bulunur (`lsof -d cwd`); hiçbir
    repoda değilse repo adı gösterilmez.
  - Liste yalnız değişince sayfaya gönderilir.
  - **Gösterim (benim önerim, kullanıcı onayladı):** durum çubuğunun sağında `● N servers`
    sayacı; sunucu yoksa gizli. Tıklayınca menü: her satırda `localhost:PORT`, repo adı ve
    sekmenin başlığı (ör. `npm run dev`). Satıra tıklamak `http://localhost:PORT/`
    adresini varsayılan tarayıcıda açar. Sunucunun çalıştığı terminal sekmesinde port
    küçük bir etiket olarak görünür (birden çok portta ilki ve `+N`).
  - **Yapılmayanlar:** edi sunuculara istek atmaz (yoklama, sağlık denetimi yok), sunucu
    durdurmaz ya da yeniden başlatmaz, terminal çıktısını okumaz. edi dışında başlayan
    sunucular (Docker, başka terminal uygulaması) görünmez.
  - **Ödünleşim:** porta bakarak `https` anlaşılamaz; adres hep `http://` ile açılır.
    HTTPS kullanan dev sunucusuna terminaldeki adrese Option+tık ile ulaşılır.
  - Terminaldeki `http(s)://…` adresleri Option+tık ile tarayıcıda açılır (yapıldı).
