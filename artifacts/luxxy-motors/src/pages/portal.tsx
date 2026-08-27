import { useState, useRef } from 'react';
import { UploadCloud, X, Lock, CheckCircle2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetStockQueryKey, replaceStock, verifyPortalPassword } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { type StockData } from '@/lib/stock-context';

export default function Portal() {
  const [password, setPassword] = useState(() => sessionStorage.getItem('portal_password') || '');
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!sessionStorage.getItem('portal_password'));
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [successData, setSuccessData] = useState<{count: number, dealerName?: string, scrapedAt?: string} | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;

    setError(null);
    setIsLoggingIn(true);
    try {
      await verifyPortalPassword({
        headers: { 'x-portal-password': password },
      });
      sessionStorage.setItem('portal_password', password);
      setIsAuthenticated(true);
    } catch {
      setError('Incorrect portal password.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const processFile = async (file: File) => {
    setError(null);
    setSuccessData(null);
    if (!file.name.endsWith('.json')) {
      setError('Please upload a valid .json file.');
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      
      let newStock: StockData;

      if (Array.isArray(parsed)) {
        throw new Error('Invalid format. Expected a wrapped object with a "cars" array, not a direct array.');
      } else if (parsed.cars && Array.isArray(parsed.cars)) {
        if (parsed.cars.length === 0) throw new Error('Cars array is empty.');
        newStock = {
          dealerName: parsed.dealerName,
          dealerLocation: parsed.dealerLocation,
          count: parsed.count,
          scrapedAt: parsed.scrapedAt,
          cars: parsed.cars.map((c: any, i: number) => ({ ...c, id: c.id || c.advertId || `car-${i}` })),
        };
      } else {
        throw new Error('Invalid format. Expected object with "cars" array.');
      }

      setIsUploading(true);
      const activePassword = sessionStorage.getItem('portal_password') || '';
      
      await replaceStock(newStock, { headers: { 'x-portal-password': activePassword } });
      
      queryClient.invalidateQueries({ queryKey: getGetStockQueryKey() });
      
      setSuccessData({
        count: newStock.cars.length,
        dealerName: newStock.dealerName,
        scrapedAt: newStock.scrapedAt
      });
      
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Failed to update stock. Incorrect password or server error.');
      // If unauthorized, clear password and log out
      if (err.status === 401 || err.status === 403 || err.message?.toLowerCase().includes('unauthorized')) {
        sessionStorage.removeItem('portal_password');
        setIsAuthenticated(false);
        setPassword('');
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
        <div className="w-full max-w-sm p-8 bg-card border rounded-2xl shadow-sm">
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <h1 className="text-2xl font-bold text-center">Staff Portal</h1>
            <p className="text-muted-foreground text-center text-sm mt-1">Enter your password to manage stock</p>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-4">
            <Input 
              type="password" 
              placeholder="Password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
            <Button type="submit" className="w-full" disabled={isLoggingIn}>
              {isLoggingIn ? 'Checking…' : 'Login'}
            </Button>
            {error && <p className="text-sm font-medium text-destructive text-center">{error}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4 py-8">
      <div className="text-center mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-primary mb-3">Update Stock</h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          Upload your latest <span className="font-medium text-foreground">full-stock.json</span> to update the showroom.
        </p>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !isUploading && fileInputRef.current?.click()}
        className={`w-full max-w-xl p-12 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-all duration-200 group
          ${isDragging ? 'border-primary bg-primary/5 scale-[1.02]' : 'border-border bg-card hover:border-primary/50 hover:bg-muted/50'}
          ${isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <input 
          type="file" 
          accept=".json" 
          className="hidden" 
          ref={fileInputRef}
          onChange={(e) => {
            if (e.target.files && e.target.files[0]) processFile(e.target.files[0]);
            if (e.target) e.target.value = '';
          }}
          disabled={isUploading}
        />
        
        <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
          <UploadCloud className="w-10 h-10 text-primary" />
        </div>
        
        <h3 className="text-xl font-semibold mb-2">{isUploading ? 'Uploading...' : 'Select or drop your file'}</h3>
        <p className="text-muted-foreground text-center mb-6">
          Select <span className="font-medium text-foreground">full-stock.json</span>. Expected format is a JSON object with a "cars" array.
        </p>
        
        <Button size="lg" variant="default" className="pointer-events-none" disabled={isUploading}>
          Browse Files
        </Button>
      </div>

      {error && (
        <div className="mt-6 p-4 bg-destructive/10 text-destructive rounded-lg flex items-center gap-3 animate-in fade-in slide-in-from-bottom-2 max-w-xl w-full">
          <X className="w-5 h-5 shrink-0" />
          <p className="font-medium">{error}</p>
        </div>
      )}

      {successData && (
        <div className="mt-6 p-6 bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400 rounded-xl flex flex-col items-center gap-3 animate-in fade-in slide-in-from-bottom-2 max-w-xl w-full text-center">
          <CheckCircle2 className="w-8 h-8 text-green-500" />
          <div>
            <p className="font-semibold text-lg text-green-800 dark:text-green-300">Stock Updated Successfully</p>
            <p className="text-sm mt-1 opacity-90">
              {successData.count} vehicles loaded
              {successData.dealerName ? ` for ${successData.dealerName}` : ''}
              {successData.scrapedAt ? ` (Generated: ${new Date(successData.scrapedAt).toLocaleDateString()})` : ''}.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
