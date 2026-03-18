import React, { useState, useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { Tag, Printer, Trash2, Bookmark, BookmarkCheck, X, Pencil, Shuffle, Loader2 } from 'lucide-react';
import { db } from '../services/db';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type BarcodeFormat = 'EAN13' | 'EAN8' | 'UPC' | 'CODE128' | 'CODE39';

interface LabelConfig {
  barcodeValue: string;
  labelText: string;
  format: BarcodeFormat;
}

// Espelha os nomes de coluna do Supabase (snake_case)
interface SavedLabel {
  id: string;
  name: string;
  barcode_value: string;
  label_text: string;
  format: BarcodeFormat;
  created_at: string;
}

// ─── Formatos suportados ──────────────────────────────────────────────────────

const FORMATS: { value: BarcodeFormat; label: string; description: string }[] = [
  { value: 'EAN13',   label: 'EAN-13',   description: 'Varejo (13 dígitos)' },
  { value: 'EAN8',    label: 'EAN-8',    description: 'Embalagens pequenas (8 dígitos)' },
  { value: 'UPC',     label: 'UPC-A',    description: 'Mercado americano (12 dígitos)' },
  { value: 'CODE128', label: 'Code 128', description: 'Logística, texto livre' },
  { value: 'CODE39',  label: 'Code 39',  description: 'Industrial, alfanumérico' },
];

// ─── Gerador aleatório por formato ───────────────────────────────────────────

function randomDigits(n: number): number[] {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10));
}

function ean13CheckDigit(d: number[]): number {
  return (10 - (d.reduce((s, v, i) => s + v * (i % 2 === 0 ? 1 : 3), 0) % 10)) % 10;
}
function ean8CheckDigit(d: number[]): number {
  return (10 - (d.reduce((s, v, i) => s + v * (i % 2 === 0 ? 3 : 1), 0) % 10)) % 10;
}
function upcCheckDigit(d: number[]): number {
  return (10 - (d.reduce((s, v, i) => s + v * (i % 2 === 0 ? 3 : 1), 0) % 10)) % 10;
}

function generateRandom(format: BarcodeFormat): string {
  switch (format) {
    case 'EAN13': { const d = randomDigits(12); return [...d, ean13CheckDigit(d)].join(''); }
    case 'EAN8':  { const d = randomDigits(7);  return [...d, ean8CheckDigit(d)].join(''); }
    case 'UPC':   { const d = randomDigits(11); return [...d, upcCheckDigit(d)].join(''); }
    case 'CODE39': {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    }
    default: return randomDigits(12).join('');
  }
}

// ─── Impressão via nova janela ────────────────────────────────────────────────

function printLabel(config: LabelConfig) {
  // Gera o SVG em memória
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, config.barcodeValue.trim(), {
      format: config.format,
      lineColor: '#000000',
      width: 3,
      height: 80,
      displayValue: true,
      fontSize: 14,
      textAlign: 'center',
      textPosition: 'bottom',
      margin: 12,
      background: '#ffffff',
    });
  } catch {
    alert('Código inválido para o formato selecionado.');
    return;
  }

  const svgHTML = svg.outerHTML;
  const descriptionHTML = config.labelText.trim()
    ? `<p class="desc">${config.labelText}</p>`
    : '';

  const win = window.open('', '_blank', 'width=500,height=500');
  if (!win) { alert('Permita popups para imprimir.'); return; }

  win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Etiqueta</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: monospace;
      background: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .label {
      background: white;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 20px 24px;
      text-align: center;
      max-width: 420px;
      width: 100%;
    }
    .desc {
      font-size: 16px;
      font-weight: bold;
      color: #0f172a;
      margin-bottom: 16px;
      padding-bottom: 14px;
      border-bottom: 1px solid #e2e8f0;
    }
    svg { width: 100%; height: auto; display: block; margin: 0 auto; }
    @media print {
      @page { margin: 6mm; }
      body { background: white; padding: 0; }
      .label { border: none; border-radius: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="label">
    ${descriptionHTML}
    ${svgHTML}
  </div>
  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`);
  win.document.close();
}

// ─── Barcode preview (tela) ───────────────────────────────────────────────────

const BarcodePreview: React.FC<{ value: string; format: BarcodeFormat; small?: boolean }> = ({ value, format, small }) => {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current || !value.trim()) return;
    try {
      JsBarcode(ref.current, value.trim(), {
        format,
        lineColor: '#000000',
        width: small ? 1.2 : 2,
        height: small ? 32 : 60,
        displayValue: !small,
        fontSize: 12,
        margin: small ? 4 : 8,
        background: '#ffffff',
      });
    } catch { /* valor inválido para o formato */ }
  }, [value, format, small]);

  if (!value.trim()) {
    return (
      <div className="flex items-center justify-center h-16 text-slate-300 text-xs">
        {small ? '—' : 'Digite um código acima'}
      </div>
    );
  }

  return <svg ref={ref} className="w-full" />;
};

// ─── Card de preview na tela ──────────────────────────────────────────────────

const LabelCard: React.FC<{ config: LabelConfig }> = ({ config }) => (
  <div
    className="bg-white border-2 border-dashed border-slate-300 rounded-xl overflow-hidden"
    style={{ width: '100%', maxWidth: 400, fontFamily: 'monospace' }}
  >
    <div className="flex items-center justify-center min-h-[72px] px-6 py-4 border-b border-slate-200">
      {config.labelText.trim() ? (
        <p className="text-center text-base font-bold text-slate-900 leading-snug">{config.labelText}</p>
      ) : (
        <p className="text-center text-sm text-slate-300 italic">Sem descrição</p>
      )}
    </div>
    <div className="px-4 py-3">
      <BarcodePreview value={config.barcodeValue} format={config.format} />
    </div>
  </div>
);

// ─── Modal de registro ────────────────────────────────────────────────────────

const RegisterModal: React.FC<{
  label: LabelConfig;
  onConfirm: (name: string) => void;
  onClose: () => void;
}> = ({ label, onConfirm, onClose }) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const fmt = FORMATS.find(f => f.value === label.format);

  useEffect(() => { inputRef.current?.focus(); }, []);
  const submit = () => { if (name.trim()) onConfirm(name.trim()); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-5 border border-slate-100 dark:border-slate-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookmarkCheck className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            <h3 className="font-bold text-slate-800 dark:text-white">Registrar Etiqueta</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={18} /></button>
        </div>

        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg p-3 space-y-1">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
            {fmt?.label}
          </span>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">{label.barcodeValue || '—'}</p>
          {label.labelText && <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate">{label.labelText}</p>}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Nome para identificar esta etiqueta</label>
          <input
            ref={inputRef}
            type="text"
            placeholder="Ex: Produto A — Rota Norte"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-medium text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
            Cancelar
          </button>
          <button onClick={submit} disabled={!name.trim()} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg font-medium text-sm transition-colors">
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── View principal ────────────────────────────────────────────────────────────

export const LabelsView: React.FC = () => {
  const [label, setLabel] = useState<LabelConfig>({ barcodeValue: '', labelText: '', format: 'EAN13' });
  const [savedLabels, setSavedLabels] = useState<SavedLabel[]>([]);
  const [loadingLabels, setLoadingLabels] = useState(true);
  const [savingLabel, setSavingLabel] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);

  // Carrega etiquetas do Supabase ao montar
  useEffect(() => {
    db.getSavedLabels().then(data => {
      setSavedLabels(data as SavedLabel[]);
      setLoadingLabels(false);
    });
  }, []);

  const updateLabel = (field: keyof LabelConfig, value: string) =>
    setLabel(prev => ({ ...prev, [field]: value }));

  const handleFormatChange = (format: BarcodeFormat) =>
    setLabel(prev => ({ ...prev, format, barcodeValue: '' }));

  const confirmRegister = async (name: string) => {
    setSavingLabel(true);
    try {
      await db.addSavedLabel({
        name,
        barcode_value: label.barcodeValue,
        label_text: label.labelText,
        format: label.format,
      });
      // Recarrega a lista do banco para ter o id gerado pelo Supabase
      const updated = await db.getSavedLabels();
      setSavedLabels(updated as SavedLabel[]);
      setShowRegisterModal(false);
    } catch (e) {
      alert('Erro ao registrar etiqueta.');
    } finally {
      setSavingLabel(false);
    }
  };

  const deleteSaved = async (id: string) => {
    try {
      await db.deleteSavedLabel(id);
      setSavedLabels(prev => prev.filter(l => l.id !== id));
    } catch {
      alert('Erro ao excluir etiqueta.');
    }
  };

  const loadSaved = (saved: SavedLabel) => {
    setLabel({ barcodeValue: saved.barcode_value, labelText: saved.label_text, format: saved.format ?? 'CODE128' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const currentFmt = FORMATS.find(f => f.value === label.format)!;

  return (
    <>
      {showRegisterModal && (
        <RegisterModal label={label} onConfirm={confirmRegister} onClose={() => setShowRegisterModal(false)} />
      )}

      <div className="space-y-8 max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
            <Tag className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-white">Gerador de Etiquetas Logísticas</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Configure, registre e imprima etiquetas de código de barras.</p>
          </div>
        </div>

        {/* Editor */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-5 space-y-4">

          {/* Seletor de formato */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Tipo de código de barras</label>
            <div className="flex flex-wrap gap-2">
              {FORMATS.map(f => (
                <button
                  key={f.value}
                  onClick={() => handleFormatChange(f.value)}
                  title={f.description}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    label.format === f.value
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">{currentFmt.description}</p>
          </div>

          {/* Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Código de barras</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Digite ou gere um código"
                  value={label.barcodeValue}
                  onChange={e => updateLabel('barcodeValue', e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
                <button
                  onClick={() => updateLabel('barcodeValue', generateRandom(label.format))}
                  title={`Gerar ${currentFmt.label} aleatório`}
                  className="px-2.5 py-2 border border-slate-200 dark:border-slate-600 rounded-lg text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                >
                  <Shuffle size={15} />
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Descrição / Rota</label>
              <input
                type="text"
                placeholder="Ex: Rota: Setor Sul"
                value={label.labelText}
                onChange={e => updateLabel('labelText', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-800 dark:text-white placeholder-slate-400 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Preview */}
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Preview</p>
            <LabelCard config={label} />
          </div>

          {/* Ações */}
          <div className="pt-1 border-t border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => setShowRegisterModal(true)}
              disabled={!label.barcodeValue.trim() || savingLabel}
              className="flex items-center justify-center gap-2 px-4 py-2.5 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              {savingLabel ? <Loader2 size={15} className="animate-spin" /> : <Bookmark size={15} />}
              Registrar Etiqueta
            </button>
            <button
              onClick={() => printLabel(label)}
              disabled={!label.barcodeValue.trim()}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
            >
              <Printer size={16} />
              Imprimir Etiqueta
            </button>
          </div>
        </div>

        {/* Etiquetas Registradas */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <BookmarkCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">Etiquetas Registradas</h3>
            {!loadingLabels && (
              <span className="ml-1 text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-full px-2 py-0.5 font-semibold">
                {savedLabels.length}
              </span>
            )}
          </div>

          {loadingLabels ? (
            <div className="flex items-center justify-center py-10 text-slate-400 gap-2">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-sm">Carregando etiquetas...</span>
            </div>
          ) : savedLabels.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-8 border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
              Nenhuma etiqueta registrada ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {savedLabels.map(saved => {
                const fmt = FORMATS.find(f => f.value === (saved.format ?? 'CODE128'));
                return (
                  <div key={saved.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm px-4 py-3 flex items-center gap-4">
                    <div className="w-24 shrink-0 bg-white rounded overflow-hidden border border-slate-100">
                      <BarcodePreview value={saved.barcode_value} format={saved.format ?? 'CODE128'} small />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-semibold text-sm text-slate-800 dark:text-white truncate">{saved.name}</p>
                        <span className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 font-mono">
                          {fmt?.label}
                        </span>
                      </div>
                      {saved.label_text && <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{saved.label_text}</p>}
                      <p className="text-xs text-slate-400 dark:text-slate-500 font-mono truncate mt-0.5">{saved.barcode_value}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => loadSaved(saved)} title="Abrir no editor"
                        className="p-2 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20">
                        <Pencil size={15} />
                      </button>
                      <button onClick={() => printLabel({ barcodeValue: saved.barcode_value, labelText: saved.label_text, format: saved.format ?? 'CODE128' })}
                        title="Imprimir"
                        className="p-2 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20">
                        <Printer size={15} />
                      </button>
                      <button onClick={() => deleteSaved(saved.id)} title="Excluir registro"
                        className="p-2 text-slate-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

      </div>
    </>
  );
};
