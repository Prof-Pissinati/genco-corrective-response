import { useCallback } from 'react';

export function useGridInteraction({
    isEditMode,
    setSelectedElement,
    toggleSwitch,
    toggleFault,
    onPinCard // 👈 NOVO: Função para fixar o Post-it
}) {
    // === INTERAÇÃO COM BARRAS (NODES) ===
    const handleNodeClick = useCallback((nodeId, event) => {
        if (isEditMode) return;

        const isCtrl = event?.ctrlKey || event?.originalEvent?.ctrlKey || event?.metaKey || event?.originalEvent?.metaKey;
        const isShift = event?.shiftKey || event?.originalEvent?.shiftKey;

        if (isCtrl) {
            setSelectedElement({ type: 'node', id: parseInt(nodeId) });
            return; // SEM tooltip, SEM toggleFault
        }
        if (isShift) {
            setSelectedElement({ type: 'node', id: parseInt(nodeId) });
            if (onPinCard) onPinCard('node', nodeId, event);
            return;
        }
        toggleFault(parseInt(nodeId));
    }, [isEditMode, setSelectedElement, toggleFault, onPinCard]);

    const handleEdgeClick = useCallback((branchObj, fallbackId, event) => {
        if (isEditMode) return;

        const branchId = branchObj.id !== undefined ? branchObj.id : fallbackId;
        const isCtrl = event?.ctrlKey || event?.originalEvent?.ctrlKey || event?.metaKey || event?.originalEvent?.metaKey;
        const isShift = event?.shiftKey || event?.originalEvent?.shiftKey;

        if (isCtrl) {
            setSelectedElement({ type: 'edge', data: branchObj });
            return; // SEM tooltip, SEM toggleSwitch
        }
        if (isShift) {
            setSelectedElement({ type: 'edge', data: branchObj });
            if (onPinCard) onPinCard('line', branchId, event);
            return;
        }
        if (branchObj.hasSwitch) toggleSwitch(branchId);
    }, [isEditMode, setSelectedElement, toggleSwitch, onPinCard]);

    return {
        handleNodeClick,
        handleEdgeClick
    };
}