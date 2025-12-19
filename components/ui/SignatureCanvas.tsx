import React, { useRef, useEffect, useState } from 'react';
import { Eraser } from 'lucide-react';

interface SignatureCanvasProps {
  onEnd: (dataUrl: string) => void;
  className?: string;
}

const SignatureCanvas: React.FC<SignatureCanvasProps> = ({ onEnd, className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI displays
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    
    // Pequeno delay para garantir que o elemento pai já renderizou o tamanho final
    setTimeout(() => {
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        ctx.scale(ratio, ratio);
        
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 3; // Aumentei um pouco a espessura para ficar mais legível
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
    }, 50);

  }, []);

  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault(); // Prevent scrolling on touch
    setIsDrawing(true);
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    
    const { x, y } = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    if (isDrawing && canvasRef.current) {
      setIsDrawing(false);
      onEnd(canvasRef.current.toDataURL());
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Reset path
    ctx.beginPath();
    setHasSignature(false);
    onEnd('');
  };

  return (
    <div className={`relative border-2 border-dashed border-gray-300 rounded-lg bg-white touch-none ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block rounded-lg cursor-crosshair" 
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
      {hasSignature && (
        <button
          onClick={clear}
          className="absolute top-2 right-2 p-2 bg-white/90 shadow-sm rounded-full text-red-500 hover:text-red-700 transition-colors z-10"
          type="button"
        >
          <Eraser size={24} />
        </button>
      )}
      {!hasSignature && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-gray-400">
          <span className="text-lg font-medium bg-white/80 px-2 rounded">Assine aqui (Dedo ou Mouse)</span>
        </div>
      )}
    </div>
  );
};

export default SignatureCanvas;