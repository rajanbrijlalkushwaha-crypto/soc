import { useEffect, useRef, useState } from 'react';

export default function SplitPane({ left, right, defaultSplit = 55 }) {
  const containerRef = useRef();
  const [split, setSplit] = useState(defaultSplit);
  const dragging = useRef(false);

  const onMouseDown = (e) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct  = ((e.clientX - rect.left) / rect.width) * 100;
      setSplit(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
    };
  }, []);

  return (
    <div ref={containerRef} style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* Left pane */}
      <div style={{ width: `${split}%`, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {left}
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        onMouseEnter={e => { e.currentTarget.querySelectorAll('span').forEach(s => s.style.background = '#1976d2'); }}
        onMouseLeave={e => { e.currentTarget.querySelectorAll('span').forEach(s => s.style.background = '#bbb'); }}
        title="Drag to resize"
        style={{
          width: '8px', flexShrink: 0, cursor: 'col-resize',
          background: 'transparent',
          borderLeft: '1px solid #ddd', borderRight: '1px solid #ddd',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: '3px',
          userSelect: 'none',
        }}
      >
        {[0,1,2].map(i => (
          <span key={i} style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#bbb', display: 'block' }} />
        ))}
      </div>

      {/* Right pane */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {right}
      </div>
    </div>
  );
}
