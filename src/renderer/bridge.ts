import type { EdiApi } from '../shared/api';

declare global {
  interface Window {
    edi: EdiApi;
  }
}

/** Bridge to the main process (defined in preload). */
export const edi: EdiApi = window.edi;
