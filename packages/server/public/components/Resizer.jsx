// Resizer — vertical drag handle between two CSS-grid columns.
// Reports the new size in pixels via onResize(px).
// Constraints: clamped to [min, max].
// side='left'  → divider RIGHT of the left rail; drag right grows left rail.
// side='right' → divider LEFT of the right rail; drag right shrinks right rail.

const Resizer = ({ getCurrent, onResize, min = 180, max = 560, side = 'left' }) => {
  const onDown = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startSize = getCurrent();
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const delta = side === 'left' ? dx : -dx;
      const next = Math.max(min, Math.min(max, startSize + delta));
      onResize(next);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      onMouseDown={onDown}
      title="Drag to resize"
    />
  );
};

window.Resizer = Resizer;
