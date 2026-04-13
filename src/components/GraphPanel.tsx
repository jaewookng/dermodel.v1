import { useEffect, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { X, Network } from 'lucide-react';
import { useGraphData, GraphTarget, GraphNode } from '@/hooks/useGraphData';

interface GraphPanelProps {
  target: GraphTarget | null;
  onClose: () => void;
}

const NODE_COLORS: Record<GraphNode['type'], string> = {
  focal: '#7c3aed',
  ingredient: '#059669',
  product: '#2563eb',
};

export const GraphPanel = ({ target, onClose }: GraphPanelProps) => {
  const { data: graphData, isLoading } = useGraphData(target);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 400, height: 600 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex flex-col h-full bg-white/95 backdrop-blur-sm rounded-lg shadow-2xl overflow-hidden pointer-events-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Network className="h-4 w-4 text-violet-600 shrink-0" />
          <span className="text-sm font-semibold text-gray-800 truncate">
            {target?.name}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <div className="hidden sm:flex items-center gap-2 text-[10px] text-gray-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-violet-600 inline-block" />
              focal
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
              product
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
              ingredient
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1"
            aria-label="Close graph"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Graph canvas */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-500 mb-2 mx-auto" />
              <p className="text-xs text-gray-500">Building graph…</p>
            </div>
          </div>
        )}

        {mounted && !isLoading && graphData && graphData.nodes.length > 0 && (
          <ForceGraph2D
            graphData={graphData}
            width={size.width}
            height={size.height}
            backgroundColor="transparent"
            nodeColor={(node: any) => NODE_COLORS[(node as GraphNode).type] ?? '#94a3b8'}
            nodeVal={(node: any) => ((node as GraphNode).type === 'focal' ? 12 : 4)}
            nodeLabel={(node: any) => (node as GraphNode).name}
            linkColor={() => '#e2e8f0'}
            linkWidth={1}
            enableNodeDrag
            enableZoomInteraction
            enablePanInteraction
            nodeCanvasObjectMode={() => 'after'}
            nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
              const isFocal = (node as GraphNode).type === 'focal';
              // Show focal label always; show others only when zoomed in
              if (!isFocal && globalScale < 1.4) return;
              const raw = (node as GraphNode).name ?? '';
              const label = raw.length > 22 ? raw.slice(0, 21) + '…' : raw;
              const fontSize = isFocal ? 11 / globalScale : 8 / globalScale;
              ctx.font = `${isFocal ? '600 ' : ''}${fontSize}px Inter, system-ui, sans-serif`;
              ctx.fillStyle = isFocal ? '#4c1d95' : (node as GraphNode).type === 'product' ? '#1e40af' : '#065f46';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';
              // Offset below the node circle (radius ≈ sqrt(nodeVal)*4)
              const offset = isFocal ? 16 / globalScale : 10 / globalScale;
              ctx.fillText(label, node.x, node.y + offset);
            }}
          />
        )}

        {!isLoading && graphData && (
          <div className="absolute bottom-2 right-2 text-[10px] text-gray-400 pointer-events-none">
            {graphData.nodes.length} nodes · {graphData.links.length} edges
          </div>
        )}
      </div>
    </div>
  );
};
