import React from 'react';

export const Sidebar: React.FC = () => {
  const styles = {
    container: {
      width: '100%',
      height: '100%',
      backgroundColor: '#1a1d27',
      color: '#e8eaed',
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column' as const,
      gap: '16px',
    },
    title: {
      fontSize: '24px',
      fontWeight: '600',
      margin: '0',
    },
    subtitle: {
      fontSize: '14px',
      color: '#9aa0a6',
      margin: '0',
    },
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>TabFlow Sidebar</h1>
      <p style={styles.subtitle}>Coming Soon</p>
    </div>
  );
};
