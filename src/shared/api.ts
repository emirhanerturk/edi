/**
 * Ana süreç ile sayfa arasındaki sözleşme. Yalnız tür içerir: sayfa Node'a erişemez,
 * bu dosyadan çalışan kod almaz.
 */

/** Sayfaya `window.edi` olarak verilen köprü. Görevler ilerledikçe büyür. */
export interface EdiApi {
  /** Köprünün sürümü; sayfa ile ana sürecin aynı derlemeden geldiğini doğrulamak için. */
  readonly version: number;
}
