import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import '@fontsource/opendyslexic/400.css';
import '@fontsource/opendyslexic/700.css';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
