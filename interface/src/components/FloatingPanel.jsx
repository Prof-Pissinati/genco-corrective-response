import React, { useCallback, useEffect, useRef, useState } from 'react';
import { clampPosition, resolveDefaultPosition, loadPanelState, savePanelState, nextPanelZ, PANEL_RESET_EVENT } from '../utils/floatingPanel';

/**
 * Floating window: dragged by its title, collapses (only the title stays), resized from the bottom-right corner, comes to the front when
 * clicked, and remembers position and state between sessions. The content scrolls inside it, so nothing becomes inaccessible.
 */
export default function FloatingPanel({ id, title, actions = null, onClose = null, closeTitle = 'Close', defaultPos = { left: 340, top: 58 }, width = 340, darkMode, testId, children }) {
    const saved = useRef(loadPanelState(id));
    const [pos, setPos] = useState(() => clampPosition(saved.current?.pos || resolveDefaultPosition(defaultPos, width), width));
    const [collapsed, setCollapsed] = useState(!!saved.current?.collapsed);
    const [z, setZ] = useState(() => nextPanelZ());
    const [dragging, setDragging] = useState(false);
    const drag = useRef(null);
    const rootRef = useRef(null);
    const posRef = useRef(pos);
    posRef.current = pos;
    const collapsedRef = useRef(collapsed);
    collapsedRef.current = collapsed;

    const bg = darkMode ? 'rgba(24,24,28,0.97)' : 'rgba(255,255,255,0.98)';
    const fg = darkMode ? '#e8e8e8' : '#222';
    const muted = darkMode ? '#9a9a9a' : '#666';
    const line = darkMode ? '#3a3a40' : '#ddd';

    const persist = useCallback((p, c) => savePanelState(id, { pos: p, collapsed: c }), [id]);

    const onMove = useCallback((e) => {
        if (!drag.current) return;
        const next = clampPosition({ left: e.clientX - drag.current.dx, top: e.clientY - drag.current.dy }, drag.current.width);
        setPos(next);
    }, []);
    const onUp = useCallback(() => {
        if (!drag.current) return;
        drag.current = null;
        setDragging(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        persist(posRef.current, collapsedRef.current);
    }, [onMove, persist]);

    const startDrag = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('button, input, select, a')) return;           // clicking the title buttons does not drag
        const rect = e.currentTarget.parentElement.getBoundingClientRect();
        drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, width: rect.width };
        setDragging(true);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        e.preventDefault();
    };

    useEffect(() => () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); }, [onMove, onUp]);
    useEffect(() => {                                                          // browser window shrank: keeps the title reachable
        const onResize = () => setPos(p => clampPosition(p, width));
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [width]);

    // "Layout" button: back to the default position, size and (expanded) state
    useEffect(() => {
        const onReset = () => {
            setPos(clampPosition(resolveDefaultPosition(defaultPos, width), width));
            setCollapsed(false);
            setZ(nextPanelZ());
            if (rootRef.current) { rootRef.current.style.width = `${width}px`; rootRef.current.style.height = ''; }   // undoes the resizing
        };
        window.addEventListener(PANEL_RESET_EVENT, onReset);
        return () => window.removeEventListener(PANEL_RESET_EVENT, onReset);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [width, defaultPos.left, defaultPos.right, defaultPos.top]);

    const toggle = () => setCollapsed(c => { persist(posRef.current, !c); return !c; });
    const small = { background: 'transparent', border: `1px solid ${muted}`, color: muted, borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 'bold', lineHeight: 1.4 };

    return (
        <div ref={rootRef} data-testid={testId} data-panel-id={id} onPointerDown={() => setZ(nextPanelZ())}
            style={{ position: 'fixed', left: pos.left, top: pos.top, width, minWidth: 240, maxWidth: '96vw', maxHeight: '88vh', zIndex: z, background: bg, color: fg,
                border: `1px solid ${line}`, borderRadius: 10, fontSize: 12, lineHeight: 1.45, boxShadow: '0 6px 24px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column',
                overflow: 'hidden', resize: collapsed ? 'none' : 'both' }}>
            <div onPointerDown={startDrag} onDoubleClick={toggle} title="Drag to move; double-click collapses"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'none', flexShrink: 0,
                    borderBottom: collapsed ? 'none' : `1px solid ${line}`, background: darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                <span style={{ color: muted, fontSize: 13, letterSpacing: -2 }}>⋮⋮</span>
                <b style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</b>
                {!collapsed && actions}
                <button style={small} onClick={toggle} title={collapsed ? 'Expand' : 'Collapse (only the title stays)'}>{collapsed ? '▸' : '▾'}</button>
                {onClose && <button style={small} onClick={onClose} title={closeTitle}>✖</button>}
            </div>
            {!collapsed && <div style={{ padding: 10, overflowY: 'auto', overflowX: 'hidden', flex: 1, minHeight: 0 }}>{children}</div>}
            {!collapsed && <div aria-hidden="true" title="Drag the corner to resize" style={{ position: 'absolute', right: 3, bottom: 1, color: muted, fontSize: 11, lineHeight: 1, pointerEvents: 'none', opacity: 0.8 }}>◢</div>}
        </div>
    );
}
