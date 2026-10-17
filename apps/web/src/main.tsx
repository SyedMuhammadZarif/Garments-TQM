import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HelloPage } from './app/HelloPage';
import './styles/theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <HelloPage />
  </StrictMode>,
);
