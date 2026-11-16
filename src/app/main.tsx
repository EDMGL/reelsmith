import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { restoreProject, startAutosave } from '../core';
import { App } from './App';
import { registerFeatures } from './registerFeatures';
import './theme.css';

registerFeatures();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

void restoreProject().then(() => startAutosave());
