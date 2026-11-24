// Terminaldeki bağlantılar: Option ile tıklanınca tarayıcıda açılır. Düz tıklama metin seçimine kalır.

/** Bağlantı eklentisinin tıklama işleyicisi. */
export function linkActivator(open: (url: string) => void): (event: MouseEvent, url: string) => void {
  return (event, url) => {
    if (event.altKey) open(url);
  };
}
