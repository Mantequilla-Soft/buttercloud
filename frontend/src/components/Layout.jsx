import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function Layout({ title, children }) {
  return (
    <div className="app">
      <Sidebar />
      <TopBar title={title} />
      <main className="main">
        {children}
      </main>
    </div>
  );
}
