import { getBaseColor } from '../hooks/useColorIntelligence';
import { THEME } from './theme';

export const exportSVG = (svgId, filename = 'diagrama_sistema.svg', calcMethod = 'NR', sources = [], feedersList = [], darkMode = true) => {
    const svgElement = document.getElementById(svgId);
    
    if (!svgElement) {
        alert(`❌ Erro: Não encontrei o gráfico na tela. Verifique se o <svg> tem o id="${svgId}".`);
        return;
    }

    try {
        const clonedSvg = svgElement.cloneNode(true);
        clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

        // Pega as dimensões reais do SVG na tela para ancorar a legenda no canto inferior direito
        const svgRect = svgElement.getBoundingClientRect();
        const svgWidth = svgRect.width || 800;
        const svgHeight = svgRect.height || 600;

        // Estilos essenciais que não são capturados nativamente
        const styleElement = document.createElementNS('http://www.w3.org/2000/svg', 'style');
        styleElement.textContent = `
            .node-label { fill: ${darkMode ? '#ffffff' : '#333333'} !important; font-family: 'Segoe UI', sans-serif; font-weight: bold; }
            text { user-select: none; font-family: 'Segoe UI', sans-serif; }
            .edge-line { transition: none !important; opacity: 1 !important; }
        `;
        clonedSvg.insertBefore(styleElement, clonedSvg.firstChild);

        // ==========================================================
        // DESENHA A LEGENDA VETORIZADA (Agora Dinâmica e Tematizada)
        // ==========================================================
        const allRoots = [...sources, ...feedersList];
        const legendData = [];
        
        sources.forEach(s => legendData.push({ color: getBaseColor(s, allRoots, darkMode), text: `SUB ${s}` }));
        feedersList.forEach(f => legendData.push({ color: getBaseColor(f, allRoots, darkMode), text: `ALIM ${f}` }));
        
        legendData.push({ color: THEME[darkMode ? 'dark' : 'light'].fault,  text: "Falta/Sobrecarga" });
        legendData.push({ color: THEME[darkMode ? 'dark' : 'light'].loop,   text: "Loop" });
        legendData.push({ color: THEME[darkMode ? 'dark' : 'light'].de,     text: "Desenergizado" });

        const legendG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        legendG.setAttribute('class', 'export-legend');
        
        // Posicionamento Dinâmico: 160px da borda direita, 30px + altura da legenda da borda inferior
        const legendHeight = 15 + (legendData.length * 22);
        const posX = svgWidth - 160;
        const posY = svgHeight - legendHeight - 30;
        legendG.setAttribute('transform', `translate(${posX}, ${posY})`); 

        // Tema Dinâmico para a Legenda
        const bgFill = darkMode ? '#1e1e1e' : '#ffffff';
        const bgStroke = darkMode ? '#444444' : '#cccccc';
        const textFill = darkMode ? '#ffffff' : '#333333';

        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('width', '140');
        bgRect.setAttribute('height', `${legendHeight}`); 
        bgRect.setAttribute('rx', '8'); 
        bgRect.setAttribute('fill', bgFill); 
        bgRect.setAttribute('stroke', bgStroke); 
        bgRect.setAttribute('stroke-width', '1');
        legendG.appendChild(bgRect);

        legendData.forEach((item, i) => {
            const itemG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            itemG.setAttribute('transform', `translate(10, ${15 + (i * 22)})`);

            const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            dot.setAttribute('cx', '6'); dot.setAttribute('cy', '0'); dot.setAttribute('r', '6');
            dot.setAttribute('fill', item.color);
            itemG.appendChild(dot);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', '20'); text.setAttribute('y', '4');
            text.setAttribute('fill', textFill); text.setAttribute('font-size', '12px');
            text.textContent = item.text;
            itemG.appendChild(text);

            legendG.appendChild(itemG);
        });

        clonedSvg.appendChild(legendG);

        // 5. SERIALIZA E BAIXA
        const serializer = new XMLSerializer();
        let source = '<?xml version="1.0" standalone="no"?>\r\n' + serializer.serializeToString(clonedSvg);

        const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const downloadLink = document.createElement("a");
        downloadLink.href = url; downloadLink.download = filename; downloadLink.style.display = "none";
        
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);

        setTimeout(() => URL.revokeObjectURL(url), 500);

    } catch (error) {
        console.error("Erro ao gerar SVG:", error);
        alert("Houve um erro ao gerar a imagem. Verifique o console.");
    }
};
