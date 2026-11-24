import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { FirebaseProvider } from './contexts/FirebaseContext.tsx';
import './index.css';

(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

const origError = console.error;
console.error = (...args: unknown[]) => {
  origError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
};

const canonicalHref = `${window.location.origin}${window.location.pathname}`;
let canonicalLink = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
if (!canonicalLink) {
  canonicalLink = document.createElement('link');
  canonicalLink.rel = 'canonical';
  document.head.appendChild(canonicalLink);
}
canonicalLink.href = canonicalHref;

let ogUrlMeta = document.querySelector('meta[property="og:url"]') as HTMLMetaElement | null;
if (!ogUrlMeta) {
  ogUrlMeta = document.createElement('meta');
  ogUrlMeta.setAttribute('property', 'og:url');
  document.head.appendChild(ogUrlMeta);
}
ogUrlMeta.content = canonicalHref;

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <FirebaseProvider>
      <App />
    </FirebaseProvider>
  </ErrorBoundary>
);
