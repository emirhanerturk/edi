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

// No StrictMode: in development it runs effects twice, which means starting and killing an
// extra shell process on every launch.
createRoot(document.getElementById('root')!).render(<App />);
