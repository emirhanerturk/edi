import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-ext-400.css';
import '@fontsource/ibm-plex-sans/latin-ext-500.css';
import '@fontsource/ibm-plex-sans/latin-ext-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-ext-400.css';
import '@fontsource/ibm-plex-mono/latin-ext-500.css';
import './theme.css';
import './app.css';
import './terminals/terminals.css';
import './git/git.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// StrictMode kullanılmıyor: geliştirmede etkileri iki kez çalıştırır, bu da her açılışta
// fazladan bir kabuk süreci başlatıp öldürmek demek.
createRoot(document.getElementById('root')!).render(<App />);
