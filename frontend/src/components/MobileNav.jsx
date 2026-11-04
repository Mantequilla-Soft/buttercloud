import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// On narrow screens the sidebar becomes an off-canvas drawer. Its open state
// lives on <body> as a class so every shell (Layout, AdminLayout, Files) can
// share it without threading props through.

const OPEN_CLASS = 'nav-open';

function setOpen(open) {
  document.body.classList.toggle(OPEN_CLASS, open);
}

export function NavToggle() {
  return (
    <button
      type="button"
      className="icon-btn nav-toggle"
      aria-label="Open menu"
      onClick={() => setOpen(!document.body.classList.contains(OPEN_CLASS))}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    </button>
  );
}

// Dims the page behind the open drawer; tapping it closes the drawer.
// Also closes the drawer whenever the route changes.
export function NavBackdrop() {
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => () => setOpen(false), []);

  return <div className="nav-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />;
}
