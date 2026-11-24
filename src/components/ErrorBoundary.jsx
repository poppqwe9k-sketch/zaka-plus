import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error || '')
    };
  }

  componentDidCatch(error) {
    console.error('Plus AI UI ErrorBoundary caught error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          style={{
            minHeight: '100dvh',
            display: 'grid',
            placeItems: 'center',
            padding: '24px',
            background: '#f7f8fa',
            color: '#20232a',
            fontFamily: "'IBM Plex Sans Arabic', Tahoma, Arial, sans-serif"
          }}
        >
          <div
            style={{
              maxWidth: '460px',
              width: '100%',
              padding: '24px',
              borderRadius: '18px',
              background: '#ffffff',
              border: '1px solid #e6e8ed',
              boxShadow: '0 14px 40px #00000012',
              textAlign: 'center'
            }}
          >
            <img
              src="/logo.png?v=6"
              alt="Plus AI"
              width="48"
              height="48"
              style={{ borderRadius: '12px', marginBottom: '12px' }}
            />
            <h2 style={{ margin: '0 0 8px', fontSize: '18px' }}>حدث خطأ غير متوقع في الواجهة</h2>
            <p style={{ margin: '0 0 18px', fontSize: '13px', color: '#646b77', lineHeight: 1.6 }}>
              يرجى إعادة تحميل الصفحة للمتابعة.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                minHeight: '42px',
                padding: '0 20px',
                border: 0,
                borderRadius: '12px',
                background: '#20232a',
                color: '#ffffff',
                font: 'inherit',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              إعادة التحميل
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
