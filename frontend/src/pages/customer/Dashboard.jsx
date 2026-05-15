import Layout from '../../components/Layout';

export default function Dashboard() {
  return (
    <Layout title="Dashboard">
      <h1 style={{ marginTop: 0 }}>Welcome back!</h1>
      <p style={{ color: 'var(--fg-2)' }}>Navigate to <strong>Files</strong> to start browsing your storage, or explore other sections.</p>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '16px',
        marginTop: '32px',
      }}>
        <div style={{
          padding: '24px',
          border: '1px solid var(--line-soft)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-2)',
        }}>
          <div style={{ fontSize: '12px', color: 'var(--fg-2)', textTransform: 'uppercase', marginBottom: '8px' }}>
            Storage Used
          </div>
          <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--fg)' }}>
            0 GB
          </div>
        </div>

        <div style={{
          padding: '24px',
          border: '1px solid var(--line-soft)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-2)',
        }}>
          <div style={{ fontSize: '12px', color: 'var(--fg-2)', textTransform: 'uppercase', marginBottom: '8px' }}>
            Monthly Cost
          </div>
          <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--fg)' }}>
            $0.00
          </div>
        </div>

        <div style={{
          padding: '24px',
          border: '1px solid var(--line-soft)',
          borderRadius: 'var(--radius)',
          background: 'var(--bg-2)',
        }}>
          <div style={{ fontSize: '12px', color: 'var(--fg-2)', textTransform: 'uppercase', marginBottom: '8px' }}>
            API Requests
          </div>
          <div style={{ fontSize: '24px', fontWeight: 600, color: 'var(--fg)' }}>
            0
          </div>
        </div>
      </div>
    </Layout>
  );
}
