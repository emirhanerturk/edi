import type { EdiApi } from '../shared/api';

declare global {
  interface Window {
    edi: EdiApi;
  }
}

/** Ana sürece açılan köprü (preload'da tanımlı). */
export const edi: EdiApi = window.edi;
