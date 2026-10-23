import { useEffect } from 'react';

export function useShortcuts({
    setShowShortcuts, setPrintFrameMode, setDarkMode, setShowLabels,
    setCalcMethod, resetSystem, setIsEditMode, handleUndoLayout,
    handleExportSVG
}) {
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            const key = e.key.toLowerCase();

            // Original shortcuts
            if (e.key === 'Escape') { setShowShortcuts(false); return; }
            if (key === 'p' && !e.ctrlKey) setPrintFrameMode(prev => prev === 'none' ? 'landscape' : (prev === 'landscape' ? 'portrait' : 'none'));
            if (key === 'd') setDarkMode(prev => !prev);
            if (key === 'l') setShowLabels(prev => !prev);
            if (key === 'm') setCalcMethod(prev => prev === 'NR' ? 'GS' : 'NR');
            if (key === 'r') resetSystem();
            if (key === 'e') setIsEditMode(prev => !prev);
            if (key === 'z' && !e.ctrlKey) { e.preventDefault(); window.dispatchEvent(new CustomEvent('triggerZoomExtents')); }
            if (key === 'z' && e.ctrlKey) { e.preventDefault(); handleUndoLayout(); }
            if (key === 'h') setShowShortcuts(true);

            // --- NEW SHORTCUTS ---
            if (key === 's' && handleExportSVG) handleExportSVG();
            
            // Triggers a click on the "Open" button (looked up by class)
            if (key === 'o') {
                const btnOpen = document.querySelector('button[title*="Import"], button[title*="Open"]');
                if (btnOpen) btnOpen.click();
            }

            // ROTATION: fires global events for the EditSidebar to listen to
            if (e.key === '[') window.dispatchEvent(new CustomEvent('triggerRotate', { detail: -10 }));
            if (e.key === ']') window.dispatchEvent(new CustomEvent('triggerRotate', { detail: 10 }));
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        setShowShortcuts, setPrintFrameMode, setDarkMode, setShowLabels,
        setCalcMethod, resetSystem, setIsEditMode, handleUndoLayout,
        handleExportSVG
    ]);
}