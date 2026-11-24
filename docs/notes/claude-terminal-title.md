# Claude Code'un terminal başlığı

Claude Code durumunu terminal başlığına (OSC 0) yazar. edi, arka plandaki bir Claude sekmesinin
sizi beklediğini bu başlıktan anlar. Aşağıdaki kayıt 24 Kasım 2026'da Claude Code 2.1.331 ile,
node-pty üzerinden açılan bir oturumda alındı (`TERM_PROGRAM=edi`, `TERM=xterm-256color`).

## Kayıt

Saniye, ardından gelen dizi. Aynı başlığın tekrarları çıkarıldı.

Kısa bir yanıt:

```
  0.9  OSC 0 "✳ Claude Code"            açılış, boşta
  7.0  --- istem gönderildi
  7.4  OSC 0 "◐ Claude Code"            çalışıyor
  8.3  OSC 0 "◑ Claude Code"
  8.4  OSC 0 "◑ Basit yanıt isteği"     oturum adını aldı
  9.3  OSC 0 "◐ Basit yanıt isteği"
  9.6  OSC 0 "✳ Basit yanıt isteği"     yanıt bitti, boşta
```

İzin sorusu (`--permission-mode default`, dosya yazma isteği):

```
  0.7  OSC 0 "✳ Claude Code"
  7.0  --- istem gönderildi
  7.4  OSC 0 "◐ Claude Code"
  8.5  OSC 0 "◑ Perm-test2.txt dosya yazma"
  9.3  OSC 0 "◐ Perm-test2.txt dosya yazma"
 10.1  OSC 0 "✳ Perm-test2.txt dosya yazma"   "Do you want to create …?" sorusu ekranda
 34.0  --- Escape (reddedildi); başlık değişmedi
 40.3  OSC 0 ""                               süreç kapandı
```

## Çıkan kural

| Başlığın ilk karakteri | Durum |
|---|---|
| `◐` ya da `◑` (yaklaşık saniyede bir dönüşür) | çalışıyor |
| `✳` | sizi bekliyor: yanıt bitti ya da izin soruyor |
| başka her şey (boş başlık, kabuğun kendi başlığı) | Claude Code'un başlığı değil |

- "Yanıt bitti" ile "izin soruyor" başlıktan ayırt edilemez; ikisi de `✳`. Zil ikisinde de aynıdır.
- İlk karakterden sonraki metin oturumun adıdır ve dile göre değişir; kural ona bakmaz.
- Bu oturumlarda BEL (`\a`) hiç gelmedi; zil ona dayanmaz.
- Başka diziler de görüldü ve yok sayılır: `OSC 7501 "?"` (açılışta) ve dosya bağlantıları için `OSC 8`.

Başlık biçimi Claude Code'un belgelenmiş bir sözleşmesi değildir; bir sürümde değişirse zil
çalmaz olur (yanlış çalmaz). O durumda bu kayıt yeniden alınır ve `src/shared/claudeTitle.ts`
güncellenir.
