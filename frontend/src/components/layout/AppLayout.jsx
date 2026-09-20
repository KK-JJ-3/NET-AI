import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

function AppLayout({ children, activePage, onNavigate }) {
  return (
    <div className="app-shell">
      <Sidebar activePage={activePage} onNavigate={onNavigate} />

      <div className="app-area">
        <TopBar activePage={activePage} />

        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}

export default AppLayout;
