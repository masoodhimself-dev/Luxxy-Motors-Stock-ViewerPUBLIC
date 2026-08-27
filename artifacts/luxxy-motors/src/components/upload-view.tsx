import { useState, useRef } from 'react';
import { UploadCloud, X } from 'lucide-react';
import { useStock, type StockData } from '@/lib/stock-context';
import { Button } from '@/components/ui/button';

export function UploadView() {
  const { setStock } = useStock();
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setError(null);
    if (!file.name.endsWith('.json')) {
      setError('Please upload a valid .json file.');
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      
      let newStock: StockData;

      if (Array.isArray(parsed)) {
        if (parsed.length === 0) throw new Error('Array is empty.');
        newStock = {
          cars: parsed.map((c, i) => ({ ...c, id: c.id || c.advertId || `car-${i}` })),
        };
      } else if (parsed.cars && Array.isArray(parsed.cars)) {
        newStock = {
          dealerName: parsed.dealerName,
          count: parsed.count,
          scrapedAt: parsed.scrapedAt,
          cars: parsed.cars.map((c: any, i: number) => ({ ...c, id: c.id || c.advertId || `car-${i}` })),
        };
      } else {
        throw new Error('Invalid format. Expected array of cars or object with "cars" array.');
      }

      setStock(newStock);
    } catch (err: any) {
      setError(err.message || 'Failed to parse JSON file.');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-primary mb-3">Luxxy Motors</h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          Upload your latest stock feed to update the showroom. Expected format is <span className="font-mono text-sm bg-muted px-1.5 py-0.5 rounded">full-stock.json</span>.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`w-full max-w-2xl p-12 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all duration-200 group
          ${isDragging ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-border bg-card hover:border-primary/50 hover:bg-muted/50'}
        `}
      >
        <input 
          type="file" 
          accept=".json" 
          className="hidden" 
          ref={fileInputRef}
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) processFile(e.target.files[0]);
            // reset to allow re-uploading the same file if needed
            if (e.target) e.target.value = '';
          }}
        />
        
        <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
          <UploadCloud className="w-10 h-10 text-primary" />
        </div>
        
        <h3 className="text-xl font-semibold mb-2">Select or drop your file</h3>
        <p className="text-muted-foreground text-center mb-6">
          Drag and drop your JSON file here, or click to browse.
        </p>
        
        <Button size="lg" variant="default" className="pointer-events-none">
          Browse Files
        </Button>
      </div>

      {error && (
        <div className="mt-6 p-4 bg-destructive/10 text-destructive rounded-lg flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2">
          <X className="w-5 h-5 shrink-0" />
          <p className="font-medium">{error}</p>
        </div>
      )}
    </div>
  );
}
