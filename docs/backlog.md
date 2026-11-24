# Bekleyen küçük sorunlar

Plan 1–4 ve sunucu listesinin son incelemelerinden ertelenen bulgular, kullanıcıya etkisine
göre sıralı. Bir madde düzeltilince buradan silinir. Son güncelleme: 2026-11-24.

## Yüksek öncelik: iş kaybı ya da yanlış bilgi

1. **Claude sekmeleri tanınmayabiliyor.** `pgrep -x claude`, sürüm numaralı kurulumu
   bulamıyor: süreç `ps`'te `claude` diye görünse de çekirdekteki adı sürüm numarası
   (`2.1.331`). Böyle bir Claude çalışan sekmenin simgesi ve "yanıt bekliyor" zili çalışmaz,
   oturum sayısı eksik çıkar. (sonradan bulundu; `src/sessions.ts` `listClaudePids`)
2. **Hook çalışırken yazılan commit mesajı kaybolabiliyor.** Commit bitince kutu temizleniyor;
   hook sürerken eklenen metin de gidiyor. (plan 1)
3. **Push ya da commit sürerken çıkış ve klasör değiştirme sorulmuyor.** Süren git işlemi
   yarıda kesilebilir. (plan 1)
4. **Reddedilen push'un sebebi görünmüyor.** Hata satırı seçici sunucunun gerekçesini
   gizliyor; bir hook reddederse hook çıktısının yalnız son satırı görünüyor. (plan 1)
5. **macOS'tan çıkış ya da yeniden başlatma iptal olabilir.** edi kapanışı her seferinde
   erteliyor; oturum kapatmayı engelleyebilir. Doğrulanmadı. (plan 1)

## Orta öncelik: günlük kullanımda can sıkar

6. **Bir yavaş repo hepsini bekletiyor.** Ekran ancak bütün repoların durumu gelince
   yenileniyor (`refreshAll`). (plan 1)
7. **Klasör değiştirme anında yarışlar.** O sırada açılan terminal sessizce ölü kalabiliyor;
   son klasörlerden birine çift tık iki kez açıyor; `edi` ile arka arkaya iki devir
   `Workspace.open`'da yarışabiliyor (nesil denetimi yok); uygulama hazır olmadan gelen devir
   kayboluyor. (plan 1, plan 4)
8. **Artık var olmayan bir son klasörü açmak** başka bir klasör açıkken sessizce başarısız
   oluyor. (plan 1)
9. **Kurulum atomik değil.** `npm run dist` eskisini silip yenisini kopyalıyor; kopyalama
   yarıda kalırsa uygulama gider, yarım paket sonraki kurulumları "not edi" diye durdurur.
   (plan 4)
10. **Files ağacı her yoklamada yeniden kuruluyor** (`buildTree`, memo yok). (plan 2)
11. **İç içe repo ya da submodule** Files'ta adsız ya da açılamayan bir satır olarak
    görünüyor. (plan 2)
12. **Testler gerçek `~/.profile`'ı çalıştırıyor** (pty ve e2e kabukları);
    `tests/sessions.test.ts:70-76` hiç düşemiyor. (plan 1)
13. **Detached HEAD'den arayüzle bir branch'e dönülemiyor.** (plan 1)

## Düşük öncelik: kenar durumlar ve görünüm

14. **Klavye erişimi:** orta panel sekmeleri; satırları Space ile açmak ve klavyeyle
    sabitlemek (Files, History); ağaçta ok tuşları; menülerde ok tuşları. (plan 2, 3, sunucular)
15. **History:** yeni etiket ya da `-u`'suz push ancak yenileyince görünüyor (`historyKey`
    etiketleri ve uzak ref'leri saymıyor); "Load 50 more" By repo'da da çıkıyor, 5000
    sınırında kalıyor, yüklenirken iki kez ekleyebiliyor; UTF-8 dışı
    `i18n.logOutputEncoding` Türkçe karakterleri bozuyor (`--encoding=UTF-8`). (plan 3)
16. **Commit görünümü:** gövde paragraflarının baştaki girintisi siliniyor; renklendirme
    bütçeyi aşan ilk dosyada duruyor (atlayıp devam etmeli); README 3.000 satırlık açık dosya
    bütçesini anmıyor. (plan 3)
17. **Sunucu listesi:** menü sunucular gidip gelince kendiliğinden yeniden açılıyor; kapatılan
    sekmenin satırı 3 sn kalıyor; klasör değişiminde kısa yarış; kesilen `lsof` çıktısı bir
    yoklama yanlış port gösterebilir; tarayıcıda açma (ve terminalde Option+tık) başarısız
    olursa uyarı yok. (sunucular)
18. **Görünüm ve küçük davranışlar:** uzun branch adı açık repo başlığında repo adını
    sıkıştırıyor; Zed soğuk açılışta (5 sn+) iki kez açılabiliyor; dal menüsü sayfa kayınca
    kapanıyor; seçili satır dosya ile diff görünümünü ayırt etmiyor. (plan 1, 2)
19. **Kurulum ayrıntıları:** pakette ~60 MB node-pty Windows dosyası ve kaynağı;
    `isRunning`'in `pgrep -f` deseni sabitlenmemiş (yanlış pozitif); `~/.local/bin` PATH'te
    değilse uyarı yok; `edi -` ve izinsiz klasör "not a folder" diyor. (plan 4)
20. **Teorik riskler:** dosya okumada `realpath` ile `open` arasında TOCTOU, büyüyen dosyada
    sınırsız okuma; meşgul kilidinin bırakılması yenilemenin hata vermemesine bağlı;
    `process.env` açılıştan sonra değiştiriliyor; commit'siz SHA-256 repoda diff tabanı
    yanlış. (plan 1, 2, 4)
