import { useAuth } from "../auth/AuthContext";

function ProtectedRoute({ children }) {
  const { loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="auth-loading">
        <div className="loading-spinner" />
        <p>Loading NetFault AI...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return children;
}

export default ProtectedRoute;
