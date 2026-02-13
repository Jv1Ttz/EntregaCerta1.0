import React, { useRef, useEffect, useState } from 'react';
import SignaturePad from 'signature_pad';
import { Eraser, Lock, Unlock, PenTool } from 'lucide-react';

interface SignatureCanvasProps {
  onEnd: (dataUrl: string) => void;
  className?: string;
}

const SignatureCanvas: React.FC<SignatureCanvasProps> = ({ onEnd, className }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signaturePadRef = useRef<SignaturePad | null>(null);
  const [isLocked, setIsLocked] = useState(true); 
  const [isEmpty, setIsEmpty] = useState(true);
  
  // Ref para guardar o tempo do último toque
  const lastTapRef = useRef<number>(0);

  // Inicializa o SignaturePad
  useEffect(() => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      const context = canvas.getContext("2d");
      if (context) context.scale(ratio, ratio);

      const signaturePad = new SignaturePad(canvas, {
        backgroundColor: 'rgba(255, 255, 255, 0)', 
        penColor: 'black',
        minWidth: 1,
        maxWidth: 2.5,
      });

      signaturePad.addEventListener("endStroke", () => {
        setIsEmpty(signaturePad.isEmpty());
        const dataUrl = signaturePad.toDataURL("image/png"); 
        onEnd(dataUrl);
      });

      signaturePadRef.current = signaturePad;

      if (isLocked) {
        signaturePad.off();
      }
    }

    return () => {
      signaturePadRef.current?.off();
    };
  }, []);

  // Controla o Bloqueio/Desbloqueio
  useEffect(() => {
    if (signaturePadRef.current) {
      if (isLocked) {
        signaturePadRef.current.off(); 
      } else {
        signaturePadRef.current.on(); 
      }
    }
  }, [isLocked]);

  const clearSignature = () => {
    if (signaturePadRef.current) {
      signaturePadRef.current.clear();
      setIsEmpty(true);
      onEnd(''); 
    }
  };

  const toggleLock = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault(); 
    e.stopPropagation();
    setIsLocked(!isLocked);
  };

  // --- NOVA LÓGICA DE DUPLO TOQUE ---
  const handleDoubleTap = (e: React.MouseEvent) => {
    // Usamos onClick porque ele filtra toques de rolagem (scroll)
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 300; // 300ms de intervalo máximo

    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // Se o segundo toque foi rápido, DESBLOQUEIA
      setIsLocked(false);
      lastTapRef.current = 0; // Reseta
    } else {
      // Se foi o primeiro toque (ou demorou muito), apenas marca o tempo
      lastTapRef.current = now;
    }
  };

  return (
    <div className={`relative rounded-lg overflow-hidden border-2 ${isLocked ? 'border-gray-200 bg-gray-50' : 'border-blue-500 bg-white shadow-md'} transition-all ${className}`}>
      
      {/* O Canvas em si */}
      <canvas 
        ref={canvasRef} 
        className={`w-full h-full touch-none ${isLocked ? 'opacity-50 pointer-events-none' : 'cursor-crosshair'}`}
        style={{ height: '100%', width: '100%' }} 
      />

      {/* CAMADA DE PROTEÇÃO (OVERLAY) - Permite Scroll */}
      {isLocked && (
        <div 
          className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-100/40 backdrop-blur-[1px] cursor-pointer"
          onClick={handleDoubleTap} // Alterado para chamar a função de duplo toque
        >
          <div className="bg-white p-3 rounded-full shadow-lg mb-2 animate-bounce">
             <PenTool className="text-blue-600 w-6 h-6" />
          </div>
          {/* Texto Atualizado */}
          <span className="text-sm font-bold text-gray-500 uppercase tracking-wider">Toque 2x para Assinar</span>
          <span className="text-[10px] text-gray-400 mt-1">(Isso bloqueia a rolagem)</span>
        </div>
      )}

      {/* BARRA DE CONTROLES */}
      <div className="absolute top-2 right-2 flex gap-2 z-20">
        
        {!isEmpty && !isLocked && (
          <button 
            type="button"
            onClick={clearSignature}
            className="p-2 bg-red-100 text-red-600 rounded-full hover:bg-red-200 transition-colors shadow-sm"
            title="Limpar assinatura"
          >
            <Eraser size={18} />
          </button>
        )}

        <button 
          type="button"
          onClick={toggleLock}
          className={`p-2 rounded-full transition-colors shadow-sm ${isLocked ? 'bg-gray-200 text-gray-600' : 'bg-blue-100 text-blue-600 hover:bg-blue-200'}`}
          title={isLocked ? "Desbloquear para assinar" : "Bloquear para rolar a tela"}
        >
          {isLocked ? <Lock size={18} /> : <Unlock size={18} />}
        </button>
      </div>

      {!isLocked && (
        <div className="absolute bottom-2 left-0 right-0 text-center pointer-events-none">
           <span className="text-[10px] bg-yellow-100 text-yellow-800 px-2 py-1 rounded opacity-80">
             Bloqueie novamente para rolar a tela
           </span>
        </div>
      )}

    </div>
  );
};

export default SignatureCanvas;